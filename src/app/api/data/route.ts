import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const KV_URL = process.env.KV_REST_API_URL || '';
const KV_TOKEN = process.env.KV_REST_API_TOKEN || '';

async function kvRaw(cmd: string, key: string, value?: unknown): Promise<string | null> {
  if (!KV_URL || !KV_TOKEN) return null;
  try {
    const url = `${KV_URL}/${cmd}/${encodeURIComponent(key)}`;
    const opts: RequestInit = { headers: { Authorization: `Bearer ${KV_TOKEN}` } };
    if (value !== undefined) {
      opts.method = 'POST';
      opts.headers = { ...opts.headers, 'Content-Type': 'application/json' };
      opts.body = JSON.stringify(value);
    }
    const res = await fetch(url, opts);
    if (!res.ok) return null;
    const data = await res.json();
    return data.result;
  } catch { return null; }
}

async function kvGetParsed<T>(key: string): Promise<T | null> {
  const raw = await kvRaw('get', key);
  if (raw === null) return null;
  try { return JSON.parse(raw) as T; } catch { return raw as T; }
}

export async function GET() {
  try {
    const [jds, candidates, version] = await Promise.all([
      kvGetParsed('recruit:jds'),
      kvGetParsed('recruit:candidates'),
      kvRaw('get', 'recruit:version'),
    ]);
    return NextResponse.json({
      jds: jds || [],
      candidates: candidates || [],
      version: parseInt(String(version)) || 0,
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
    const ok = await kvRaw('set', key, data);
    if (!ok) return NextResponse.json({ error: 'KV write failed' }, { status: 500 });

    const rawV = await kvRaw('get', 'recruit:version');
    const v = (parseInt(String(rawV)) || 0) + 1;
    await kvRaw('set', 'recruit:version', String(v));

    return NextResponse.json({ ok: true, version: v });
  } catch {
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
