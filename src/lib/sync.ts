// Multi-user data sync — version-based, debounced, conflict-free

type DataType = 'jds' | 'candidates';
type ChangeHandler = (type: DataType, data: unknown, version: number) => void;

let remoteVersion = 0;
let onChange: ChangeHandler | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let pushTimers: Partial<Record<DataType, ReturnType<typeof setTimeout>>> = {};

async function apiGet() {
  try {
    const r = await fetch('/api/data');
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

async function apiPost(type: DataType, data: unknown) {
  try {
    const r = await fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, data }),
    });
    if (r.ok) {
      const j = await r.json();
      return j.version as number;
    }
  } catch { /* offline */ }
  return null;
}

// Check remote and apply if newer
async function poll() {
  const remote = await apiGet();
  if (!remote) return;
  if (remote.version > remoteVersion) {
    remoteVersion = remote.version;
    if (onChange) {
      if (remote.jds) onChange('jds', remote.jds, remote.version);
      if (remote.candidates) onChange('candidates', remote.candidates, remote.version);
    }
  }
}

// Debounced push — waits for 1s of inactivity
function schedulePush(type: DataType, getData: () => unknown) {
  if (pushTimers[type]) clearTimeout(pushTimers[type]);
  pushTimers[type] = setTimeout(async () => {
    const v = await apiPost(type, getData());
    if (v != null) remoteVersion = v;
  }, 1000);
}

export function startSync(handler: ChangeHandler) {
  onChange = handler;

  // Initial fetch
  apiGet().then((remote) => {
    if (!remote) return;
    remoteVersion = remote.version;
    if (onChange) {
      if (remote.jds?.length) onChange('jds', remote.jds, remote.version);
      if (remote.candidates?.length) onChange('candidates', remote.candidates, remote.version);
    }
  });

  // Poll every 10s
  timer = setInterval(poll, 10000);
}

export function stopSync() {
  onChange = null;
  if (timer) { clearInterval(timer); timer = null; }
  Object.values(pushTimers).forEach(clearTimeout);
  pushTimers = {};
}

// Call after every local change — debounced
export function syncPush(type: DataType, data: unknown) {
  schedulePush(type, () => data);
}
