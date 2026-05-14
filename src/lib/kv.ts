// Vercel KV (Upstash Redis) client — shared data layer for multi-user sync

const KV_URL = process.env.KV_REST_API_URL || '';
const KV_TOKEN = process.env.KV_REST_API_TOKEN || '';

async function kvFetch<T>(command: string, ...args: (string | number)[]): Promise<T | null> {
  try {
    const url = `${KV_URL}/${command}/${args.map(encodeURIComponent).join('/')}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.result as T;
  } catch {
    return null;
  }
}

export async function kvGet<T>(key: string): Promise<T | null> {
  return kvFetch<T>('get', key);
}

export async function kvSet(key: string, value: unknown): Promise<boolean> {
  try {
    const url = `${KV_URL}/set/${encodeURIComponent(key)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function kvDel(key: string): Promise<boolean> {
  try {
    const url = `${KV_URL}/del/${encodeURIComponent(key)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Sync keys
export const SYNC_KEYS = {
  jds: 'recruit:jds',
  candidates: 'recruit:candidates',
  version: 'recruit:version',
};
