// 服务端业务存储。Supabase 为主存储；未配置时兼容旧 Upstash，便于本地迁移。
import 'server-only';

const KV = process.env.KV_REST_API_URL || '';
const TOK = process.env.KV_REST_API_TOKEN || '';
const SUPABASE = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export interface KvTransactionPayload {
  expected?: Array<{ key: string; exists: boolean; value?: string }>;
  writes?: Array<{ key: string; value: string; ttlSeconds?: number }>;
  deletes?: string[];
  increments?: string[];
  lists?: Array<{ op: 'push' | 'pop_left' | 'remove'; key: string; value?: string; count?: number }>;
}

export interface KvTransactionResult {
  ok: boolean;
  increments?: Record<string, number>;
  popped?: Record<string, string | null>;
}

function supabaseConfigured(): boolean {
  return !!(SUPABASE && SUPABASE_KEY);
}

async function supabaseRpc<T>(
  name: string,
  body: Record<string, unknown>,
  options: { attempts?: number; timeoutMs?: number } = {},
): Promise<T> {
  const attempts = Math.max(1, options.attempts || 1);
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(`${SUPABASE}/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        cache: 'no-store',
        signal: AbortSignal.timeout(options.timeoutMs || 15_000),
      });
      if (response.ok) return await response.json() as T;
      if (response.status < 500 && response.status !== 408 && response.status !== 429) break;
    } catch {
      // Read-only calls below retry brief network and timeout failures.
    }
    if (attempt + 1 < attempts) {
      await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
    }
  }
  throw new Error('业务存储暂不可用');
}

async function supabaseRead(keys: string[]): Promise<Record<string, string>> {
  // The recommendation snapshot is several MB. A 5s cutoff repeatedly aborted
  // otherwise successful reads (observed at 12s) and restarted the whole transfer.
  const fullRecommendations = keys.includes('recruit:repush');
  return supabaseRpc<Record<string, string>>('recruit_kv_read', { p_keys: keys },
    fullRecommendations ? { attempts: 1, timeoutMs: 30_000 } : { attempts: 2, timeoutMs: 6_000 });
}

export async function kvFindRepushRecords(args: {
  sourceIds: string[];
  candidateCodes: string[];
  candidateIdentityIds: string[];
  resumeUrls: string[];
  column: 'a' | 'b';
}): Promise<Array<Record<string, unknown>>> {
  const sourceIds = Array.from(new Set(args.sourceIds.map((id) => id.trim()).filter(Boolean)));
  const candidateCodes = Array.from(new Set(args.candidateCodes.map((id) => id.trim().toLowerCase()).filter(Boolean)));
  const candidateIdentityIds = Array.from(new Set(args.candidateIdentityIds.map((id) => id.trim().toLowerCase()).filter(Boolean)));
  const resumeUrls = Array.from(new Set(args.resumeUrls.map((url) => url.trim()).filter(Boolean)));
  if (!sourceIds.length && !resumeUrls.length) return [];
  if (supabaseConfigured()) {
    const records = await supabaseRpc<unknown>(
      'recruit_repush_lookup',
      {
        p_source_ids: sourceIds,
        p_candidate_codes: candidateCodes,
        p_candidate_identity_ids: candidateIdentityIds,
        p_resume_urls: resumeUrls,
        p_column: args.column,
      },
      { attempts: 3, timeoutMs: 5_000 },
    );
    if (!Array.isArray(records)) throw new Error('推荐记录格式异常');
    return records.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item)));
  }
  const raw = await kvCommandStrict<string | null>('GET', 'recruit:repush');
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('推荐记录格式异常');
  const sourceIdSet = new Set(sourceIds);
  const candidateCodeSet = new Set(candidateCodes);
  const candidateIdentityIdSet = new Set(candidateIdentityIds);
  const resumeUrlSet = new Set(resumeUrls);
  return parsed.filter((item): item is Record<string, unknown> => Boolean(
    item && typeof item === 'object' && !Array.isArray(item)
    && String((item as Record<string, unknown>).column || '') === args.column
    && (
      sourceIdSet.has(String((item as Record<string, unknown>).id || ''))
      || (
        resumeUrlSet.has(String((item as Record<string, unknown>).resumeUrl || ''))
        && (
          candidateCodeSet.has(String((item as Record<string, unknown>).candidateCode || '').trim().toLowerCase())
          || candidateIdentityIdSet.has(String((item as Record<string, unknown>).candidateIdentityId || '').trim().toLowerCase())
        )
      )
    ),
  ));
}

export async function kvTransaction(payload: KvTransactionPayload): Promise<KvTransactionResult> {
  if (supabaseConfigured()) {
    return supabaseRpc<KvTransactionResult>('recruit_kv_tx', { p_payload: payload });
  }
  throw new Error('当前存储不支持事务写入');
}

export function kvConfigured(): boolean {
  return supabaseConfigured() || !!(KV && TOK);
}

/** Storage failure is not an empty dataset. */
export async function kvCommandStrict<T>(...command: (string | number)[]): Promise<T> {
  if (supabaseConfigured()) {
    const [rawName, ...rawArgs] = command;
    const name = String(rawName).toUpperCase();
    const args = rawArgs.map(String);
    if (name === 'GET') {
      const values = await supabaseRead([args[0]]);
      return (Object.hasOwn(values, args[0]) ? values[args[0]] : null) as T;
    }
    if (name === 'MGET') {
      const values = await supabaseRead(args);
      return args.map((key) => Object.hasOwn(values, key) ? values[key] : null) as T;
    }
    if (name === 'EXISTS') {
      const values = await supabaseRead([args[0]]);
      return (Object.hasOwn(values, args[0]) ? 1 : 0) as T;
    }
    if (name === 'SET') {
      const exIndex = args.findIndex((arg) => arg.toUpperCase() === 'EX');
      const ttlSeconds = exIndex >= 0 ? Number.parseInt(args[exIndex + 1] || '', 10) : undefined;
      const result = await kvTransaction({ writes: [{ key: args[0], value: args[1] ?? '', ...(ttlSeconds ? { ttlSeconds } : {}) }] });
      if (!result.ok) throw new Error('业务存储操作失败');
      return 'OK' as T;
    }
    if (name === 'DEL') {
      const result = await kvTransaction({ deletes: args });
      if (!result.ok) throw new Error('业务存储操作失败');
      return args.length as T;
    }
    if (name === 'INCR') {
      const result = await kvTransaction({ increments: [args[0]] });
      if (!result.ok) throw new Error('业务存储操作失败');
      return Number(result.increments?.[args[0]] || 0) as T;
    }
    if (name === 'RPUSH') {
      const result = await kvTransaction({ lists: args.slice(1).map((value) => ({ op: 'push' as const, key: args[0], value })) });
      if (!result.ok) throw new Error('业务存储操作失败');
      return args.length as T;
    }
    if (name === 'LRANGE') {
      const values = await supabaseRead([args[0]]);
      let list: string[] = [];
      try { list = JSON.parse(values[args[0]] || '[]') as string[]; } catch { list = []; }
      const start = Number.parseInt(args[1] || '0', 10);
      const stop = Number.parseInt(args[2] || '-1', 10);
      return list.slice(start, stop < 0 ? undefined : stop + 1) as T;
    }
    if (name === 'LREM') {
      const result = await kvTransaction({ lists: [{ op: 'remove', key: args[0], count: Number.parseInt(args[1] || '0', 10), value: args[2] }] });
      if (!result.ok) throw new Error('业务存储操作失败');
      return 1 as T;
    }
    if (name === 'EXPIRE') {
      const values = await supabaseRead([args[0]]);
      if (!Object.hasOwn(values, args[0])) return 0 as T;
      const result = await kvTransaction({ writes: [{ key: args[0], value: values[args[0]], ttlSeconds: Number.parseInt(args[1] || '0', 10) }] });
      return (result.ok ? 1 : 0) as T;
    }
    throw new Error(`Supabase 暂不支持 ${name} 操作`);
  }
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
  if (supabaseConfigured()) {
    try {
      const values = await supabaseRead([key]);
      return Object.hasOwn(values, key) ? values[key] : null;
    } catch { return null; }
  }
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
  if (supabaseConfigured()) {
    try { return (await kvTransaction({ writes: [{ key, value }] })).ok; }
    catch { return false; }
  }
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
  if (supabaseConfigured()) {
    try { return (await kvTransaction({ deletes: [key] })).ok; }
    catch { return false; }
  }
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
