// 服务端 Upstash KV 访问（与 /api/data 一致：text/plain 原样存取，避免 JSON 引号问题）。
import 'server-only';

const KV = process.env.KV_REST_API_URL || '';
const TOK = process.env.KV_REST_API_TOKEN || '';

export function kvConfigured(): boolean {
  return !!(KV && TOK);
}

/** Storage failure is not an empty dataset. */
export async function kvCommandStrict<T>(...command: (string | number)[]): Promise<T> {
  if (!KV || !TOK) throw new Error('业务存储未配置');
  const response = await fetch(KV, {
    method: 'POST', headers: { Authorization: `Bearer ${TOK}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command), cache: 'no-store', signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error('业务存储暂不可用');
  const data = await response.json();
  if (data.error) throw new Error('业务存储操作失败');
  return data.result as T;
}

export async function kvGetRaw(key: string): Promise<string | null> {
  if (!KV || !TOK) return null;
  try {
    const res = await fetch(`${KV}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${TOK}` },
      cache: 'no-store',
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

export async function kvDelRaw(key: string): Promise<boolean> {
  if (!KV || !TOK) return false;
  try {
    const res = await fetch(`${KV}/del/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${TOK}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}

export const talentTextKey = (id: string): string => `recruit:talent-text:${id}`;
