// 多用户数据同步 — 浏览器直连 Upstash KV。
// 策略：按 id 合并（merge），而非整数组覆盖，确保「添加永不丢失」；
// 删除通过墓碑（tombstone）传播，确保删除仍能在多端生效。

// KV 凭证：优先读构建期环境变量（Vercel 项目设置 NEXT_PUBLIC_KV_URL / NEXT_PUBLIC_KV_TOKEN），
// 旧硬编码值仅作过渡兜底 —— 在 Vercel 配好环境变量并轮换 Upstash token 后，应删除兜底值。
// 注意：浏览器直连架构下 token 必然随 bundle 下发（NEXT_PUBLIC_ 前缀），
// 长期方案是把写路径收敛到 /api/data（服务端 token），此处只保留只读轮询。
const KV_URL = process.env.NEXT_PUBLIC_KV_URL || 'https://positive-mongrel-70521.upstash.io';
const KV_TOKEN = process.env.NEXT_PUBLIC_KV_TOKEN || 'gQAAAAAAARN5AAIgcDE5NDM2NzliZjdjOWY0MjBmYTA0NjhjODhjNTNjZjM3Zg';

type DataType = 'jds' | 'candidates' | 'talents' | 'repush' | 'todos' | 'companies';
// readOk：该类型的远端读取是否成功（HTTP 200）。用于区分「合法的空数据」与「读取故障返回空」，
// 接收端据此决定是否允许用空数组覆盖本地（修复「清空到 0」被永久阻断的问题）。
type ChangeHandler = (type: DataType, data: unknown[], version: number, readOk: boolean) => void;

interface Item { id?: string }
/** 墓碑：{ [type]: { [id]: 删除时间戳ms } } */
type Tombstones = Record<string, Record<string, number>>;

const KV_KEYS: Record<DataType, string> = {
  jds: 'recruit:jds',
  candidates: 'recruit:candidates',
  talents: 'recruit:talents',
  repush: 'recruit:repush',
  todos: 'recruit:todos',
  companies: 'recruit:companies',
};
const TOMB_KEY = 'recruit:tombstones';
const TOMB_TTL = 60 * 24 * 60 * 60 * 1000; // 墓碑保留 60 天后清理，避免无限增长

const ALL_TYPES: DataType[] = ['jds', 'candidates', 'talents', 'repush', 'todos', 'companies'];

let remoteVersion = 0;
let tombstones: Tombstones = {};
let onChange: ChangeHandler | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let pushTimers: Partial<Record<DataType, ReturnType<typeof setTimeout>>> = {};

async function kvCmd(cmd: string, key: string, body?: string): Promise<string | null> {
  try {
    const url = `${KV_URL}/${cmd}/${encodeURIComponent(key)}`;
    const opts: RequestInit = { headers: { Authorization: `Bearer ${KV_TOKEN}` } };
    if (body !== undefined) {
      opts.method = 'POST';
      opts.headers = { ...opts.headers, 'Content-Type': 'text/plain' };
      opts.body = body;
    }
    const res = await fetch(url, opts);
    if (!res.ok) return null;
    const data = await res.json();
    return data.result;
  } catch { return null; }
}

/** 读取单键并报告 HTTP 是否成功，用于区分「合法空」与「读取失败」。 */
async function kvGet(key: string): Promise<{ ok: boolean; value: string | null }> {
  try {
    const res = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });
    if (!res.ok) return { ok: false, value: null };
    const data = await res.json();
    return { ok: true, value: (data.result ?? null) as string | null };
  } catch {
    return { ok: false, value: null };
  }
}

/** 原子自增全局版本号（Upstash INCR），杜绝并发写的 get→+1→set 竞态导致漏版本。 */
async function bumpVersion(): Promise<number> {
  const r = await kvCmd('incr', 'recruit:version');
  return parseInt(String(r ?? '0')) || 0;
}

/** 按 id 合并：incoming 在 id 冲突时获胜；保留只存在于 base 的项（添加不丢失） */
function mergeById(base: unknown[], incoming: unknown[]): unknown[] {
  const map = new Map<string, unknown>();
  const noId: unknown[] = [];
  for (const it of base) {
    const id = (it as Item)?.id;
    if (id) map.set(id, it); else noId.push(it);
  }
  for (const it of incoming) {
    const id = (it as Item)?.id;
    if (id) map.set(id, it); else noId.push(it);
  }
  return [...Array.from(map.values()), ...noId];
}

/** 过滤掉被墓碑标记删除的项 */
function applyTombstones(type: DataType, items: unknown[]): unknown[] {
  const t = tombstones[type];
  if (!t) return items;
  return items.filter((it) => {
    const id = (it as Item)?.id;
    return !(id && t[id]);
  });
}

/** 某 id 是否已被标记删除（供客户端合并后过滤用） */
export function isTombstoned(type: DataType, id: string): boolean {
  return !!tombstones[type]?.[id];
}

async function fetchTombstones(): Promise<Tombstones> {
  const raw = await kvCmd('get', TOMB_KEY);
  return (safeParse(raw) as Tombstones) || {};
}

async function fetchRemote(): Promise<{
  data: Record<DataType, unknown[]>;
  readOk: Record<DataType, boolean>;
  version: number;
} | null> {
  try {
    const [jd, cand, talent, repush, todos, companies, rawVer, rawTomb] = await Promise.all([
      kvGet(KV_KEYS.jds),
      kvGet(KV_KEYS.candidates),
      kvGet(KV_KEYS.talents),
      kvGet(KV_KEYS.repush),
      kvGet(KV_KEYS.todos),
      kvGet(KV_KEYS.companies),
      kvCmd('get', 'recruit:version'),
      kvCmd('get', TOMB_KEY),
    ]);
    if (!jd.value && !cand.value && !talent.value && !repush.value && !todos.value && !companies.value) return null;
    tombstones = (safeParse(rawTomb) as Tombstones) || {};
    return {
      data: {
        jds: (safeParse(jd.value) as unknown[]) || [],
        candidates: (safeParse(cand.value) as unknown[]) || [],
        talents: (safeParse(talent.value) as unknown[]) || [],
        repush: (safeParse(repush.value) as unknown[]) || [],
        todos: (safeParse(todos.value) as unknown[]) || [],
        companies: (safeParse(companies.value) as unknown[]) || [],
      },
      readOk: {
        jds: jd.ok, candidates: cand.ok, talents: talent.ok,
        repush: repush.ok, todos: todos.ok, companies: companies.ok,
      },
      version: parseInt(rawVer || '0') || 0,
    };
  } catch { return null; }
}

/**
 * 推送：读-改-写合并，不再整数组覆盖。
 * 1) 拉当前远端 + 最新墓碑；2) 与本地按 id 合并（本地获胜，因为用户刚操作）；
 * 3) 过滤墓碑；4) 写回。这样即使本地是旧/不完整快照，也不会抹掉别人的新增。
 */
async function pushData(type: DataType, local: unknown[]) {
  tombstones = await fetchTombstones();
  const remoteRaw = await kvCmd('get', KV_KEYS[type]);
  const remote = (safeParse(remoteRaw) as unknown[]) || [];
  const merged = applyTombstones(type, mergeById(remote, local)); // 本地获胜
  const ok = await kvCmd('set', KV_KEYS[type], JSON.stringify(merged));
  if (!ok) return null;
  return await bumpVersion();
}

/** 删除：把 id 写入墓碑（含 TTL 清理），随后由 pushData 把数组中的对应项剔除并传播 */
export async function syncDelete(type: DataType, ids: string[]) {
  if (!ids.length) return;
  const now = Date.now();
  tombstones = await fetchTombstones();
  const t: Record<string, number> = { ...(tombstones[type] || {}) };
  for (const id of ids) t[id] = now;
  // 清理过期墓碑
  for (const id of Object.keys(t)) if (now - t[id] > TOMB_TTL) delete t[id];
  tombstones = { ...tombstones, [type]: t };
  await kvCmd('set', TOMB_KEY, JSON.stringify(tombstones));
}

async function poll() {
  // 先只查版本号（几十字节）：未变化就不下载 6 类数据的全量 JSON（可达数百KB），
  // 稳定态下把每 10 秒的轮询流量降到接近零，对国内慢链路尤其重要。
  const rawV = await kvCmd('get', 'recruit:version');
  const v = parseInt(rawV || '0') || 0;
  if (v <= remoteVersion) return;

  const remote = await fetchRemote();
  if (!remote) return;
  if (remote.version > remoteVersion) {
    remoteVersion = remote.version;
    emitAll(remote.data, remote.version, remote.readOk);
  }
}

function emitAll(data: Record<DataType, unknown[]>, version: number, readOk: Record<DataType, boolean>) {
  if (!onChange) return;
  for (const type of ALL_TYPES) {
    onChange(type, applyTombstones(type, data[type]), version, readOk[type]);
  }
}

export function startSync(handler: ChangeHandler) {
  onChange = handler;
  fetchRemote().then((remote) => {
    if (!remote) return;
    remoteVersion = remote.version;
    emitAll(remote.data, remote.version, remote.readOk);
  });
  timer = setInterval(poll, 10000);
}

export function stopSync() {
  onChange = null;
  if (timer) { clearInterval(timer); timer = null; }
  Object.values(pushTimers).forEach(clearTimeout);
  pushTimers = {};
}

function schedulePush(type: DataType, getData: () => unknown[]) {
  if (pushTimers[type]) clearTimeout(pushTimers[type]);
  pushTimers[type] = setTimeout(async () => {
    const v = await pushData(type, getData());
    if (v != null) remoteVersion = v;
  }, 1000);
}

export function syncPush(type: DataType, data: unknown[]) {
  schedulePush(type, () => data);
}

/** 把今日增改 diff 写入 KV，供其他端实时拉取 */
export async function pushImportDiff(diff: unknown): Promise<void> {
  await kvCmd('set', 'recruit:last-import-diff', JSON.stringify(diff));
  // 同时推高 version，让其他端的 10s 轮询感知到变化
  await bumpVersion();
}

/** 从 KV 拉取最新 lastImportDiff（供 SyncProvider 轮询用） */
export async function fetchImportDiff(): Promise<unknown | null> {
  return safeParse(await kvCmd('get', 'recruit:last-import-diff'));
}

/** 把本周新增累计写入 KV */
export async function pushWeeklyAdded(data: unknown): Promise<void> {
  await kvCmd('set', 'recruit:weekly-added', JSON.stringify(data));
  await bumpVersion();
}

/** 从 KV 拉取本周新增累计 */
export async function fetchWeeklyAdded(): Promise<unknown | null> {
  return safeParse(await kvCmd('get', 'recruit:weekly-added'));
}

function safeParse(raw: string | null): unknown {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
