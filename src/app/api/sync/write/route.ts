import { NextRequest, NextResponse } from 'next/server';
import { sameOriginGuard, rateLimit, clientIp } from '@/lib/api-guard';

export const dynamic = 'force-dynamic';

const KV = process.env.KV_REST_API_URL || '';
const TOK = process.env.KV_REST_API_TOKEN || '';

// 侧信道键白名单：客户端只传符号名，真实 KV 键名只存在于服务端，
// 与 /api/data 的 6 类主数据键分开管理（那些走 /api/data，这些走这里）。
const SIDE_KEYS: Record<string, string> = {
  tombstones: 'recruit:tombstones',
  version: 'recruit:version',
  'last-import-diff': 'recruit:last-import-diff',
  'weekly-added': 'recruit:weekly-added',
};

async function upstash(cmd: string, key: string, body?: string): Promise<string | null> {
  if (!KV || !TOK) return null;
  try {
    const url = `${KV}/${cmd}/${encodeURIComponent(key)}`;
    const opts: RequestInit = { headers: { Authorization: `Bearer ${TOK}` } };
    if (body !== undefined) {
      opts.method = 'POST';
      opts.headers = { ...opts.headers, 'Content-Type': 'text/plain' };
      opts.body = body;
    }
    const res = await fetch(url, opts);
    if (!res.ok) return null;
    const data = await res.json();
    return String(data.result ?? '');
  } catch { return null; }
}

/** 与 /api/data 一致：配了 DATA_WRITE_TOKEN 时校验请求头；未配置时退回同源校验。 */
function writeGuard(req: NextRequest): NextResponse | null {
  const expected = process.env.DATA_WRITE_TOKEN;
  if (expected) {
    if (req.headers.get('x-app-token') === expected) return null;
    return NextResponse.json({ error: '未授权' }, { status: 401 });
  }
  return sameOriginGuard(req);
}

export async function POST(req: NextRequest) {
  const blocked = writeGuard(req);
  if (blocked) return blocked;
  if (!rateLimit(`sync-write:${clientIp(req)}`, 60, 60_000)) {
    return NextResponse.json({ error: '写入过于频繁' }, { status: 429 });
  }
  try {
    const { op, key, value } = (await req.json()) as { op?: string; key?: string; value?: string };
    const realKey = key ? SIDE_KEYS[key] : undefined;
    if (!realKey) return NextResponse.json({ error: `未知键: ${key}` }, { status: 400 });

    if (op === 'incr') {
      const r = await upstash('incr', realKey);
      if (r == null) return NextResponse.json({ error: 'incr 失败' }, { status: 500 });
      return NextResponse.json({ ok: true, value: parseInt(r) || 0 });
    }
    if (op === 'set') {
      if (typeof value !== 'string') return NextResponse.json({ error: '缺少 value' }, { status: 400 });
      const ok = await upstash('set', realKey, value);
      if (!ok) return NextResponse.json({ error: 'set 失败' }, { status: 500 });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: `未知操作: ${op}` }, { status: 400 });
  } catch {
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
