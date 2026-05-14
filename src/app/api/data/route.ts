import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const KV = process.env.KV_REST_API_URL || '';
const TOK = process.env.KV_REST_API_TOKEN || '';

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
  try {
    const { type, data } = await req.json();
    if (!type || !data) return NextResponse.json({ error: 'Missing' }, { status: 400 });

    const key = type === 'jds' ? 'recruit:jds' : 'recruit:candidates';
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
