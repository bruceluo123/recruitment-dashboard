import { diffRecords, recordsEqual, type RecordChange, type SyncRecord } from './record-changes';

export type DataType = 'jds' | 'candidates' | 'talents' | 'repush' | 'todos' | 'companies' | 'performance';
type ChangeHandler = (type: DataType, data: unknown[], version: number, readOk: boolean) => void;
interface Mutation {
  id: string;
  type: DataType;
  changes: RecordChange[];
  createdAt: number;
  conflicts?: string[];
  resolution?: 'local';
}
const TYPES: DataType[] = ['jds', 'candidates', 'talents', 'repush', 'todos', 'companies', 'performance'];
const OUTBOX = 'recruit:record-outbox:v1';
const REPUSH_DELIVERY_FIELDS = new Set([
  'deliveryId',
  'deliveryIndex',
  'deliveryStatus',
  'deliveryUpdatedAt',
  'telegramMessageId',
  'deliveredAt',
]);
let pending: Mutation[] = [];
const observed: Partial<Record<DataType, SyncRecord[]>> = {};
const remoteApplyDepth: Partial<Record<DataType, number>> = {};
let remoteVersion = -1;
let tombstones: Record<string, Record<string, number>> = {};
let onChange: ChangeHandler | null = null;
let timer: ReturnType<typeof setInterval> | undefined;
let busy = false, reading = false;
let refreshQueued = false;
let requestedTypes = new Set<DataType>();
let loadedVersions: Partial<Record<DataType, number>> = {};
let editGeneration = 0;
let status = '';
const listeners = new Set<(message: string, conflictCount: number) => void>();
function conflictCount(): number {
  return pending.reduce((count, mutation) => count + (mutation.conflicts?.length || 0), 0);
}
function announce(message: string) {
  status = message;
  const conflicts = conflictCount();
  listeners.forEach((listener) => listener(message, conflicts));
}
export function subscribeSyncStatus(listener: (message: string, conflictCount: number) => void) {
  listeners.add(listener); listener(status, conflictCount()); return () => { listeners.delete(listener); };
}
export function isApplyingRemoteStoreUpdate(type: DataType): boolean {
  return (remoteApplyDepth[type] || 0) > 0;
}
export function applyRemoteStoreUpdate(type: DataType, update: () => unknown[]): void {
  remoteApplyDepth[type] = (remoteApplyDepth[type] || 0) + 1;
  editGeneration++;
  try { observed[type] = update() as SyncRecord[]; }
  finally { remoteApplyDepth[type] = Math.max(0, (remoteApplyDepth[type] || 1) - 1); }
}
function persistMutation(mutation: Mutation) {
  try { localStorage.setItem(`${OUTBOX}:${mutation.id}`, JSON.stringify(mutation)); }
  catch { announce('本机存储空间不足，请保持页面打开并重试同步'); }
}
async function readKeys(keys: string[]): Promise<Record<string, string | null>> {
  const params = new URLSearchParams(); keys.forEach((key) => params.append('key', key));
  const response = await fetch(`/api/sync/read?${params}`, { cache: 'no-store', signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error('数据读取失败');
  return (await response.json()).values;
}
function parse(raw: string | null): unknown { return raw ? JSON.parse(raw) : null; }
export function isTombstoned(type: DataType, id: string) { return !!tombstones[type]?.[id]; }
async function refresh(force = false) {
  if (reading) { refreshQueued ||= force; return; }
  if (!onChange || (!force && document.hidden)) return;
  reading = true;
  const generation = editGeneration;
  try {
    const head = await readKeys(['version']);
    const version = Number(head.version || 0);
    if (!force && version === remoteVersion
      && Array.from(requestedTypes).every((type) => loadedVersions[type] === version)) return;
    const types = Array.from(requestedTypes);
    if (!types.length) return;
    const values = await readKeys([...types, 'tombstones']);
    if (generation !== editGeneration) return;
    tombstones = parse(values.tombstones) as typeof tombstones || {};
    for (const type of types) {
      if (pending.some((mutation) => mutation.type === type)) continue;
      const rows = values[type] === null ? [] : parse(values[type]);
      if (!Array.isArray(rows)) throw new Error('数据格式异常');
      const data = rows.filter((row: SyncRecord) => !isTombstoned(type, row.id));
      observed[type] = data;
      loadedVersions[type] = version;
      onChange?.(type, data, version, true);
    }
    remoteVersion = version;
    if (!pending.length) announce('');
  } catch { announce('云端读取失败，已保留当前数据；连接恢复后重试'); }
  finally {
    reading = false;
    const needsRefresh = refreshQueued;
    refreshQueued = false;
    if (needsRefresh) void refresh(true);
  }
}
/** 在生成日报/看板前主动拉取一次当前账号可见的最新云端数据。 */
export async function refreshSyncedData(): Promise<void> {
  while (reading) await new Promise((resolve) => setTimeout(resolve, 50));
  await refresh(true);
}
export async function bootstrapSyncedData(data: Partial<Record<DataType, unknown[]>>): Promise<DataType[]> {
  const failed: DataType[] = [];
  for (const type of TYPES) {
    const rows = data[type];
    if (!Array.isArray(rows) || !rows.length) continue;
    try {
      const response = await fetch('/api/sync/bootstrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { [type]: rows } }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) failed.push(type);
    } catch { failed.push(type); }
  }
  return failed;
}
export async function retrySync() {
  if (busy) return;
  busy = true;
  let drainCompleted = false;
  try {
    while (pending.some((mutation) => !mutation.conflicts?.length)) {
      const mutationIndex = pending.findIndex((mutation) => !mutation.conflicts?.length);
      const mutation = pending[mutationIndex];
      announce(`正在保存 ${pending.filter((item) => !item.conflicts?.length).length} 项修改`);
      const response = await fetch('/api/sync/records', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: mutation.type,
          mutationId: mutation.id,
          changes: mutation.changes,
          resolution: mutation.resolution,
        }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({})) as { error?: string; conflicts?: string[]; forbidden?: string[] };
        if (response.status === 403 && Array.isArray(result.forbidden) && result.forbidden.length) {
          const forbiddenIds = new Set(result.forbidden);
          const readyChanges = mutation.changes.filter((change) => !forbiddenIds.has(change.id));
          localStorage.removeItem(`${OUTBOX}:${mutation.id}`);
          pending.splice(mutationIndex, 1);
          if (readyChanges.length) {
            const readyMutation: Mutation = {
              ...mutation,
              id: crypto.randomUUID(),
              changes: readyChanges,
            };
            pending.splice(mutationIndex, 0, readyMutation);
            persistMutation(readyMutation);
          }
          editGeneration++;
          announce('已忽略无权修改的本机记录，正在恢复云端数据');
          continue;
        }
        if (response.status === 409 && Array.isArray(result.conflicts) && result.conflicts.length) {
          const conflictIds = new Set(result.conflicts);
          const blockedChanges = mutation.changes.filter((change) => conflictIds.has(change.id));
          const readyChanges = mutation.changes.filter((change) => !conflictIds.has(change.id));
          localStorage.removeItem(`${OUTBOX}:${mutation.id}`);
          pending.splice(mutationIndex, 1);
          if (readyChanges.length) {
            const readyMutation: Mutation = {
              ...mutation,
              id: crypto.randomUUID(),
              changes: readyChanges,
              createdAt: mutation.createdAt,
              conflicts: undefined,
            };
            pending.splice(mutationIndex, 0, readyMutation);
            persistMutation(readyMutation);
          }
          if (blockedChanges.length) {
            const blockedMutation: Mutation = {
              ...mutation,
              id: crypto.randomUUID(),
              changes: blockedChanges,
              conflicts: Array.from(conflictIds),
              createdAt: Math.max(Date.now(), (pending.at(-1)?.createdAt || 0) + 1),
            };
            pending.push(blockedMutation);
            persistMutation(blockedMutation);
          }
          editGeneration++;
          announce('检测到同步冲突，请选择保留本机修改或采用云端版本');
          continue;
        }
        throw new Error(result.error || '保存失败，修改仍保留在本机，请重试');
      }
      localStorage.removeItem(`${OUTBOX}:${mutation.id}`);
      pending.splice(mutationIndex, 1);
      editGeneration++;
    }
    announce(conflictCount() ? '检测到同步冲突，请选择保留本机修改或采用云端版本' : '');
    await refresh(true);
    drainCompleted = true;
  } catch (error) { announce(error instanceof Error ? error.message : '保存失败，请重试'); }
  finally {
    busy = false;
    if (drainCompleted && pending.some((mutation) => !mutation.conflicts?.length)) void retrySync();
  }
}

function rebaseChanges(type: DataType, current: SyncRecord[], changes: RecordChange[]): RecordChange[] {
  const currentById = new Map(current.map((record) => [record.id, record]));
  return changes.flatMap((change): RecordChange[] => {
    const remote = currentById.get(change.id) || null;
    if (!change.after) {
      if (type === 'repush' && remote && (remote.deliveryStatus === 'queued' || remote.deliveryStatus === 'sending')) return [];
      return remote ? [{ id: change.id, before: remote, after: null }] : [];
    }
    if (!change.before) {
      if (!remote) return [{ id: change.id, before: null, after: change.after }];
      const after = { ...remote, ...change.after };
      if (type === 'repush') {
        for (const key of Array.from(REPUSH_DELIVERY_FIELDS)) {
          if (remote[key] === undefined) delete after[key];
          else after[key] = remote[key];
        }
      }
      return recordsEqual(remote, after) ? [] : [{ id: change.id, before: remote, after }];
    }
    if (!remote) return [{ id: change.id, before: null, after: change.after }];
    const after = { ...remote };
    for (const key of Array.from(new Set([...Object.keys(change.before), ...Object.keys(change.after)]))) {
      if (key === 'id' || recordsEqual(change.before[key], change.after[key])) continue;
      if (type === 'repush' && REPUSH_DELIVERY_FIELDS.has(key)) continue;
      if (change.after[key] === undefined) delete after[key];
      else after[key] = change.after[key];
    }
    return recordsEqual(remote, after) ? [] : [{ id: change.id, before: remote, after }];
  });
}

export async function resolveSyncConflicts(strategy: 'local' | 'remote') {
  if (busy || !pending.some((mutation) => mutation.conflicts?.length)) return;
  const blocked = pending.filter((mutation) => mutation.conflicts?.length);
  if (strategy === 'remote') {
    for (const mutation of blocked) localStorage.removeItem(`${OUTBOX}:${mutation.id}`);
    pending = pending.filter((mutation) => !mutation.conflicts?.length);
  } else {
    const types = Array.from(new Set(blocked.map((mutation) => mutation.type)));
    let values: Record<string, string | null>;
    try { values = await readKeys(types); }
    catch { announce('云端读取失败，暂时无法处理冲突'); return; }
    for (const mutation of blocked) {
      const raw = values[mutation.type];
      let current: unknown;
      try { current = raw === null ? [] : parse(raw); }
      catch { announce('云端数据格式异常，暂时无法处理冲突'); return; }
      if (!Array.isArray(current)) { announce('云端数据格式异常，暂时无法处理冲突'); return; }
      const changes = rebaseChanges(mutation.type, current as SyncRecord[], mutation.changes);
      localStorage.removeItem(`${OUTBOX}:${mutation.id}`);
      const index = pending.indexOf(mutation);
      if (!changes.length) pending.splice(index, 1);
      else {
        const rebased: Mutation = {
          ...mutation,
          id: crypto.randomUUID(),
          changes,
          conflicts: undefined,
          resolution: 'local',
          createdAt: Date.now(),
        };
        pending[index] = rebased;
        persistMutation(rebased);
      }
    }
  }
  editGeneration++;
  announce('正在处理同步冲突');
  await retrySync();
}
export function syncPush(type: DataType, data: unknown[], before?: unknown[]) {
  const baseline = (before || observed[type]) as SyncRecord[] | undefined;
  if (!baseline) { announce('云端尚未读取完成，请稍后再保存'); return; }
  const changes = diffRecords(baseline, data as SyncRecord[]);
  observed[type] = data as SyncRecord[];
  if (!changes.length) return;
  editGeneration++;
  const mutation = { id: crypto.randomUUID(), type, changes, createdAt: Math.max(Date.now(), (pending.at(-1)?.createdAt || 0) + 1) };
  pending.push(mutation);
  persistMutation(mutation); void retrySync();
}
export function startSync(handler: ChangeHandler, initialTypes: DataType[] = TYPES) {
  stopSync(); onChange = handler;
  initialTypes.forEach((type) => requestedTypes.add(type));
  try {
    if (!busy) pending = Object.keys(localStorage).filter((key) => key.startsWith(`${OUTBOX}:`))
      .map((key) => JSON.parse(localStorage.getItem(key)!)).sort((a, b) => a.createdAt - b.createdAt);
  }
  catch { announce('本机待同步记录无法读取，请勿清除浏览器数据'); }
  void (pending.length ? retrySync() : refresh(true));
  timer = setInterval(() => { void refresh(); }, 30_000);
  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onVisible);
}
export function requestSyncTypes(types: DataType[]) {
  let changed = false;
  for (const type of types) {
    if (!requestedTypes.has(type)) { requestedTypes.add(type); changed = true; }
  }
  if (changed && onChange) void refresh(true);
}
function onOnline() { void retrySync(); }
function onVisible() { if (!document.hidden) void refresh(true); }
export function stopSync() {
  onChange = null;
  if (timer) clearInterval(timer);
  timer = undefined;
  window.removeEventListener('online', onOnline);
  document.removeEventListener('visibilitychange', onVisible);
  requestedTypes = new Set<DataType>();
  loadedVersions = {};
  refreshQueued = false;
  remoteVersion = -1;
}
async function sideWrite(key: string, value: unknown) {
  const response = await fetch('/api/sync/write', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ op: 'set', key, value: JSON.stringify(value) }) });
  if (!response.ok) { announce('统计摘要未同步，请稍后重试'); throw new Error('统计摘要保存失败'); }
}
export const pushImportDiff = (value: unknown) => sideWrite('last-import-diff', value);
export const pushWeeklyAdded = (value: unknown) => sideWrite('weekly-added', value);
export async function fetchImportDiff() { return parse((await readKeys(['last-import-diff']))['last-import-diff']); }
export async function fetchWeeklyAdded() { return parse((await readKeys(['weekly-added']))['weekly-added']); }
