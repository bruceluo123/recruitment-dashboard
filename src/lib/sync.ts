// Multi-user data sync — direct to Upstash KV, version-based, debounced

const KV_URL = 'https://positive-mongrel-70521.upstash.io';
const KV_TOKEN = 'gQAAAAAAARN5AAIgcDE5NDM2NzliZjdjOWY0MjBmYTA0NjhjODhjNTNjZjM3Zg';

type DataType = 'jds' | 'candidates' | 'talents' | 'repush' | 'todos';
type ChangeHandler = (type: DataType, data: unknown, version: number) => void;

const KV_KEYS: Record<DataType, string> = {
  jds: 'recruit:jds',
  candidates: 'recruit:candidates',
  talents: 'recruit:talents',
  repush: 'recruit:repush',
  todos: 'recruit:todos',
};

let remoteVersion = 0;
let onChange: ChangeHandler | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let pushTimers: Partial<Record<DataType, ReturnType<typeof setTimeout>>> = {};

async function kvCmd(cmd: string, key: string, body?: string): Promise<string | null> {
  try {
    const url = `${KV_URL}/${cmd}/${encodeURIComponent(key)}`;
    const opts: RequestInit = {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    };
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

async function fetchRemote(): Promise<{ jds: unknown[]; candidates: unknown[]; talents: unknown[]; repush: unknown[]; todos: unknown[]; version: number } | null> {
  try {
    const [rawJd, rawCand, rawTalent, rawRepush, rawTodos, rawVer] = await Promise.all([
      kvCmd('get', 'recruit:jds'),
      kvCmd('get', 'recruit:candidates'),
      kvCmd('get', 'recruit:talents'),
      kvCmd('get', 'recruit:repush'),
      kvCmd('get', 'recruit:todos'),
      kvCmd('get', 'recruit:version'),
    ]);
    if (!rawJd && !rawCand && !rawTalent && !rawRepush && !rawTodos) return null;
    return {
      jds: (safeParse(rawJd) as unknown[]) || [],
      candidates: (safeParse(rawCand) as unknown[]) || [],
      talents: (safeParse(rawTalent) as unknown[]) || [],
      repush: (safeParse(rawRepush) as unknown[]) || [],
      todos: (safeParse(rawTodos) as unknown[]) || [],
      version: parseInt(rawVer || '0') || 0,
    };
  } catch { return null; }
}

async function pushData(type: DataType, data: unknown) {
  const key = KV_KEYS[type];
  const ok = await kvCmd('set', key, JSON.stringify(data));
  if (!ok) return null;
  const rawV = await kvCmd('get', 'recruit:version');
  const v = (parseInt(rawV || '0') || 0) + 1;
  await kvCmd('set', 'recruit:version', String(v));
  return v;
}

async function poll() {
  const remote = await fetchRemote();
  if (!remote) return;
  if (remote.version > remoteVersion) {
    remoteVersion = remote.version;
    if (onChange) {
      if (remote.jds.length) onChange('jds', remote.jds, remote.version);
      if (remote.candidates.length) onChange('candidates', remote.candidates, remote.version);
      if (remote.talents.length) onChange('talents', remote.talents, remote.version);
      // 复推池可为空（清空也要同步），故不判断 length
      onChange('repush', remote.repush, remote.version);
      onChange('todos', remote.todos, remote.version);
    }
  }
}

function schedulePush(type: DataType, getData: () => unknown) {
  if (pushTimers[type]) clearTimeout(pushTimers[type]);
  pushTimers[type] = setTimeout(async () => {
    const v = await pushData(type, getData());
    if (v != null) remoteVersion = v;
  }, 1000);
}

export function startSync(handler: ChangeHandler) {
  onChange = handler;
  fetchRemote().then((remote) => {
    if (!remote) return;
    remoteVersion = remote.version;
    if (onChange) {
      if (remote.jds.length) onChange('jds', remote.jds, remote.version);
      if (remote.candidates.length) onChange('candidates', remote.candidates, remote.version);
      if (remote.talents.length) onChange('talents', remote.talents, remote.version);
      onChange('repush', remote.repush, remote.version);
      onChange('todos', remote.todos, remote.version);
    }
  });
  timer = setInterval(poll, 10000);
}

export function stopSync() {
  onChange = null;
  if (timer) { clearInterval(timer); timer = null; }
  Object.values(pushTimers).forEach(clearTimeout);
  pushTimers = {};
}

export function syncPush(type: DataType, data: unknown) {
  schedulePush(type, () => data);
}

function safeParse(raw: string | null): unknown {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
