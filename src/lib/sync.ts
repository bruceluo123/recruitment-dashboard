// Multi-user data sync via polling to shared KV backend

let remoteVersion = 0;
let polling = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;

async function fetchRemote() {
  try {
    const res = await fetch('/api/data');
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function pushData(type: 'jds' | 'candidates', data: unknown) {
  try {
    await fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, data }),
    });
  } catch { /* offline — will sync on next push */ }
}

// Start polling for remote changes
export function startSync(onRemoteChange: (type: 'jds' | 'candidates', data: unknown) => void) {
  if (polling) return;
  polling = true;

  // Initial fetch
  fetchRemote().then((remote) => {
    if (remote) {
      remoteVersion = remote.version || 0;
      if (remote.jds?.length) onRemoteChange('jds', remote.jds);
      if (remote.candidates?.length) onRemoteChange('candidates', remote.candidates);
    }
  });

  // Poll every 5 seconds
  pollTimer = setInterval(async () => {
    const remote = await fetchRemote();
    if (remote && remote.version > remoteVersion) {
      remoteVersion = remote.version;
      if (remote.jds?.length) onRemoteChange('jds', remote.jds);
      if (remote.candidates?.length) onRemoteChange('candidates', remote.candidates);
    }
  }, 5000);
}

export function stopSync() {
  polling = false;
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

// Called after any local change
let pushQueue: Promise<void> = Promise.resolve();
export async function syncPush(type: 'jds' | 'candidates', data: unknown) {
  pushQueue = pushQueue.then(() => pushData(type, data));
  return pushQueue;
}
