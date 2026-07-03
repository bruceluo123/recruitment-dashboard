import { NextRequest, NextResponse } from 'next/server';
import { sameOriginGuard, rateLimit, clientIp } from '@/lib/api-guard';

export const dynamic = 'force-dynamic';

const KV = process.env.KV_REST_API_URL || '';
const TOK = process.env.KV_REST_API_TOKEN || '';

// 全部 6 类业务数据的 KV 键映射（与 src/lib/sync.ts 的 KV_KEYS 保持一致）。
const SYNC_KEYS: Record<string, string> = {
  jds: 'recruit:jds',
  candidates: 'recruit:candidates',
  talents: 'recruit:talents',
  repush: 'recruit:repush',
  todos: 'recruit:todos',
  companies: 'recruit:companies',
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

/** 写入鉴权：配置了 DATA_WRITE_TOKEN 时校验请求头；未配置时退回同源校验（非破坏性渐进加固）。 */
function writeGuard(req: NextRequest): NextResponse | null {
  const expected = process.env.DATA_WRITE_TOKEN;
  if (expected) {
    if (req.headers.get('x-app-token') === expected) return null;
    return NextResponse.json({ error: '未授权' }, { status: 401 });
  }
  return sameOriginGuard(req);
}

export async function GET() {
  try {
    const [rawJd, rawCand, rawVer] = await Promise.all([
      upstash('get', 'recruit:jds'),
      upstash('get', 'recruit:candidates'),
      upstash('get', 'recruit:version'),
    ]);
    return NextResponse.json({
      jds: safeParse(rawJd) || [],
      candidates: safeParse(rawCand) || [],
      version: parseInt(rawVer || '0') || 0,
      kvOk: !!(KV && TOK),
    });
  } catch {
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const blocked = writeGuard(req);
  if (blocked) return blocked;
  if (!rateLimit(`data-write:${clientIp(req)}`, 30, 60_000)) {
    return NextResponse.json({ error: '写入过于频繁' }, { status: 429 });
  }
  try {
    const { type, data } = await req.json();
    if (!type || !data) return NextResponse.json({ error: 'Missing' }, { status: 400 });

    const key = SYNC_KEYS[type];
    if (!key) return NextResponse.json({ error: `未知数据类型: ${type}` }, { status: 400 });
    if (!Array.isArray(data)) return NextResponse.json({ error: 'data 必须是数组' }, { status: 400 });

    const ok = await upstash('set', key, JSON.stringify(data));
    if (!ok) return NextResponse.json({ error: 'Write failed' }, { status: 500 });

    const rawV = await upstash('get', 'recruit:version');
    const v = (parseInt(rawV || '0') || 0) + 1;
    await upstash('set', 'recruit:version', String(v));

    return NextResponse.json({ ok: true, version: v });
  } catch {
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

function safeParse(raw: string | null): unknown {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
