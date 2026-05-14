import { NextRequest, NextResponse } from 'next/server';
import { kvGet, kvSet, SYNC_KEYS } from '@/lib/kv';

export const dynamic = 'force-dynamic';

// GET — read all shared data
export async function GET() {
  try {
    const [jds, candidates, version] = await Promise.all([
      kvGet(SYNC_KEYS.jds),
      kvGet(SYNC_KEYS.candidates),
      kvGet(SYNC_KEYS.version),
    ]);
    return NextResponse.json({ jds: jds || [], candidates: candidates || [], version: version || 0 });
  } catch {
    return NextResponse.json({ jds: [], candidates: [], version: 0 }, { status: 500 });
  }
}

// POST — write data (type: 'jds' | 'candidates')
export async function POST(req: NextRequest) {
  try {
    const { type, data } = await req.json();
    if (!type || !data) return NextResponse.json({ error: 'Missing type or data' }, { status: 400 });

    const key = type === 'jds' ? SYNC_KEYS.jds : SYNC_KEYS.candidates;
    const ok = await kvSet(key, data);
    if (!ok) return NextResponse.json({ error: 'Write failed' }, { status: 500 });

    // Increment version for real-time detection
    const version = ((await kvGet<number>(SYNC_KEYS.version)) || 0) + 1;
    await kvSet(SYNC_KEYS.version, version);

    return NextResponse.json({ ok: true, version });
  } catch {
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
