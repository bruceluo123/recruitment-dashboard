// 服务端 Upstash KV 访问（与 /api/data 一致：text/plain 原样存取，避免 JSON 引号问题）。
const KV = process.env.KV_REST_API_URL || '';
const TOK = process.env.KV_REST_API_TOKEN || '';

export function kvConfigured(): boolean {
  return !!(KV && TOK);
}

export async function kvGetRaw(key: string): Promise<string | null> {
  if (!KV || !TOK) return null;
  try {
    const res = await fetch(`${KV}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${TOK}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.result == null ? null : String(data.result);
  } catch {
    return null;
  }
}

export async function kvSetRaw(key: string, value: string): Promise<boolean> {
  if (!KV || !TOK) return false;
  try {
    const res = await fetch(`${KV}/set/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOK}`, 'Content-Type': 'text/plain' },
      body: value,
    });
    return res.ok;
  } catch {
    return false;
  }
}

export const talentTextKey = (id: string): string => `recruit:talent-text:${id}`;
