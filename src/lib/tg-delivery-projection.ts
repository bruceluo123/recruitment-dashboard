import 'server-only';
import { kvCommandStrict, kvTransaction } from '@/lib/kv-server';
import { recordsEqual, type SyncRecord } from '@/lib/record-changes';

const REPUSH_KEY = 'recruit:repush';
const TOMBSTONES_KEY = 'recruit:tombstones';
const PENDING = [
  { owner: 'a', key: 'recruit:tg-delivery-projection-pending' },
  { owner: 'b', key: 'recruit:tg-delivery-projection-pending-b' },
] as const;
const taskKey = (id: string) => `recruit:tg-delivery:${id}`;
type Row = Record<string, unknown>;
export interface DeliveryProjectionResult { committed: boolean; changed: number; consumed: number }
let inFlight: Promise<DeliveryProjectionResult> | undefined;

function object(value: unknown): value is Row {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
function timestamp(value: unknown): number {
  const time = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? time : 0;
}
function sent(row: Row): boolean {
  return row.deliveryStatus === 'sent' || Boolean(row.telegramMessageId);
}
function projectStatus(current: SyncRecord, task: Row, delivery: Row, index: number): SyncRecord {
  const legacySuccess = Array.isArray(task.deliveries)
    && task.deliveries.every((item) => object(item) && !item.status && item.messageId == null)
    && index < Number(task.sent || 0);
  const success = delivery.status === 'sent' || delivery.messageId != null || legacySuccess;
  const status = success ? 'sent'
    : delivery.status === 'failed' || task.status === 'failed' || task.status === 'partial_failed' ? 'failed'
      : delivery.status === 'sending' ? 'sending' : 'queued';
  const updatedAt = String(task.updatedAt || task.finishedAt || task.createdAt || '');
  const incomingAt = timestamp(updatedAt);
  const currentAt = timestamp(current.deliveryUpdatedAt);
  // Once Telegram confirmed a message, an older retry/checkpoint cannot undo it.
  if (sent(current) && !success) return current;
  if (!success && incomingAt < currentAt) return current;
  if (success && sent(current) && incomingAt < currentAt) return current;
  const ranks: Record<string, number> = { queued: 0, sending: 1, failed: 2, partial_failed: 2, sent: 3 };
  if (incomingAt === currentAt && (ranks[status] || 0) < (ranks[String(current.deliveryStatus)] || 0)) return current;
  return {
    ...current,
    deliveryStatus: status,
    deliveryUpdatedAt: incomingAt >= currentAt ? updatedAt || current.deliveryUpdatedAt : current.deliveryUpdatedAt,
    telegramMessageId: success ? (current.telegramMessageId || (delivery.messageId != null ? String(delivery.messageId) : undefined)) : undefined,
    deliveredAt: success ? (current.deliveredAt || delivery.sentAt || undefined) : undefined,
  };
}

async function projectPending(): Promise<DeliveryProjectionResult> {
  const queued = await kvCommandStrict<(string | null)[]>('MGET', ...PENDING.map((item) => item.key));
  const selected = PENDING.flatMap((queue, index) => {
    const parsed: unknown = queued[index] ? JSON.parse(queued[index]!) : [];
    if (!Array.isArray(parsed)) throw new Error('发送回执同步队列格式异常');
    return Array.from(new Set(parsed.filter((id): id is string => typeof id === 'string' && Boolean(id))))
      .slice(0, 10).map((id) => ({ ...queue, id }));
  });
  if (!selected.length) return { committed: true, changed: 0, consumed: 0 };
  const taskIds = Array.from(new Set(selected.map((item) => item.id)));
  const keys = [REPUSH_KEY, TOMBSTONES_KEY, ...taskIds.map(taskKey)];
  const raw = await kvCommandStrict<(string | null)[]>('MGET', ...keys);
  const records: unknown = raw[0] ? JSON.parse(raw[0]) : [];
  const tombstones: unknown = raw[1] ? JSON.parse(raw[1]) : {};
  if (!Array.isArray(records) || !records.every((item) => object(item) && typeof item.id === 'string') || !object(tombstones)
    || (tombstones.repush !== undefined && !object(tombstones.repush))) {
    throw new Error('推荐记录格式异常，暂不合并发送回执');
  }
  const deleted = object(tombstones.repush) ? tombstones.repush : {};
  const next = records.slice() as SyncRecord[];
  const indices = new Map<string, number>();
  next.forEach((row, index) => {
    indices.set(row.id, index);
    if (typeof row.applicationId === 'string') indices.set(row.applicationId, index);
  });
  const tasks = new Map(taskIds.map((id, index) => [id, raw[index + 2]]));
  let changed = 0;
  for (const entry of selected) {
    const value = tasks.get(entry.id);
    let task: unknown;
    try { task = value ? JSON.parse(value) : null; } catch { task = null; }
    // Missing/expired/corrupt tasks can be discarded only under the same task CAS.
    if (!object(task) || task.id !== entry.id || (task.sender && task.sender !== entry.owner)
      || !Array.isArray(task.deliveries)) continue;
    const deliveries = task.deliveries;
    const applications = Array.isArray(task.applications) ? task.applications.filter((item): item is Row => (
      object(item) && typeof item.applicationId === 'string' && Boolean(item.applicationId)
    )) : [];
    const bases = Array.isArray(task.businessRecords) ? task.businessRecords.filter(object) : [];
    for (const base of bases) {
      const id = typeof base.id === 'string' ? base.id : '';
      const index = Number(base.deliveryIndex);
      if (!id || indices.has(id) || (typeof base.applicationId === 'string' && indices.has(base.applicationId))
        || base.column !== entry.owner || base.deliveryId !== entry.id
        || !Number.isInteger(index) || index < 0 || !object(deliveries[index])
        || !base.fileName || !base.uploadedAt || !base.candidateName
        || deleted[id] || (typeof base.applicationId === 'string' && deleted[base.applicationId])) continue;
      const row = projectStatus({ ...base, id }, task, deliveries[index], index);
      indices.set(id, next.length);
      if (typeof row.applicationId === 'string') indices.set(row.applicationId, next.length);
      next.push(row);
      changed++;
    }
    for (let rowIndex = 0; rowIndex < next.length; rowIndex++) {
      const current = next[rowIndex];
      if (current.column !== entry.owner || deleted[current.id]
        || (typeof current.applicationId === 'string' && deleted[current.applicationId])) continue;
      const application = applications.find((item) => item.applicationId === current.id || item.applicationId === current.applicationId);
      if (current.deliveryId ? current.deliveryId !== entry.id : !application) continue;
      const index = Number(current.deliveryIndex ?? application?.index);
      if (!Number.isInteger(index) || index < 0 || !object(deliveries[index])) continue;
      const projected = projectStatus(current, task, deliveries[index], index);
      if (!recordsEqual(current, projected)) { next[rowIndex] = projected; changed++; }
    }
  }
  const committed = await kvTransaction({
    expected: keys.map((key, index) => ({ key, exists: raw[index] !== null, ...(raw[index] !== null ? { value: raw[index] } : {}) })),
    writes: changed ? [{ key: REPUSH_KEY, value: JSON.stringify(next) }] : [],
    // No whole-queue CAS: another user can append unrelated receipts concurrently.
    lists: selected.map((item) => ({ op: 'remove' as const, key: item.key, count: 0, value: item.id })),
    increments: changed ? ['recruit:version'] : [],
  });
  return { committed: committed.ok, changed: committed.ok ? changed : 0, consumed: committed.ok ? selected.length : 0 };
}

/** Retryable business projection is independent from Telegram delivery checkpoints. */
export function projectTgDeliveryRecords(): Promise<DeliveryProjectionResult> {
  if (!inFlight) inFlight = projectPending().finally(() => { inFlight = undefined; });
  return inFlight;
}
