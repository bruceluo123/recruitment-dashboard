import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const KV_URL = process.env.KV_REST_API_URL || '';
const KV_TOKEN = process.env.KV_REST_API_TOKEN || '';

async function kvCmd<T>(cmd: string, key: string, value?: unknown): Promise<T | null> {
  if (!KV_URL || !KV_TOKEN) return null;
  try {
    const url = `${KV_URL}/${cmd}/${encodeURIComponent(key)}`;
    const opts: RequestInit = {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    };
    if (value !== undefined) {
      opts.method = 'POST';
      opts.headers = { ...opts.headers, 'Content-Type': 'application/json' };
      opts.body = JSON.stringify(value);
    }
    const res = await fetch(url, opts);
    if (!res.ok) return null;
    const data = await res.json();
    return data.result as T;
  } catch { return null; }
}

export async function GET() {
  try {
    const [jds, candidates, version] = await Promise.all([
      kvCmd('get', 'recruit:jds'),
      kvCmd('get', 'recruit:candidates'),
      kvCmd('get', 'recruit:version'),
    ]);
    return NextResponse.json({
      jds: jds || [],
      candidates: candidates || [],
      version: version || 0,
      kvOk: !!(KV_URL && KV_TOKEN),
    });
  } catch {
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { type, data } = await req.json();
    if (!type || !data) return NextResponse.json({ error: 'Missing type or data' }, { status: 400 });

    const key = type === 'jds' ? 'recruit:jds' : 'recruit:candidates';
    const ok = await kvCmd('set', key, data);
    if (!ok) return NextResponse.json({ error: 'KV write failed', kvOk: !!(KV_URL && KV_TOKEN) }, { status: 500 });

    const v = ((await kvCmd<number>('get', 'recruit:version')) || 0) + 1;
    await kvCmd('set', 'recruit:version', v);

    return NextResponse.json({ ok: true, version: v });
  } catch {
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
