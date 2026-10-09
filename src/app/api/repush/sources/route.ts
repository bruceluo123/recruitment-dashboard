import { NextRequest, NextResponse } from 'next/server';
import { guardApi } from '@/lib/api-guard';
import { requireOwnerSession } from '@/lib/auth-api';
import { kvFindRepushRecords } from '@/lib/kv-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { owner?: string; ids?: unknown } | null;
  if (!body || (body.owner !== 'a' && body.owner !== 'b') || !Array.isArray(body.ids)
    || body.ids.length < 1 || body.ids.length > 10
    || body.ids.some((id: unknown) => typeof id !== 'string' || !id.trim() || id.length > 240)) {
    return NextResponse.json({ error: '原推荐编号无效' }, { status: 400 });
  }
  const owner = body.owner;
  const unauthorized = await requireOwnerSession(request, owner);
  if (unauthorized) return unauthorized;
  const blocked = guardApi(request, 'repush-sources', 30, 60_000);
  if (blocked) return blocked;

  try {
    const ids = Array.from(new Set((body.ids as string[]).map((id) => id.trim())));
    const records = await kvFindRepushRecords({
      sourceIds: ids, candidateCodes: [], candidateIdentityIds: [], resumeUrls: [], column: owner,
    });
    const requested = new Set(ids);
    return NextResponse.json({ ok: true, items: records
      .filter((record) => requested.has(String(record.id || '')) && record.column === owner)
      .map((record) => ({ id: record.id, rawText: String(record.rawText || '') })) });
  } catch {
    return NextResponse.json({ error: '原推荐暂时无法读取，已停止发送，请稍后重试' }, { status: 503 });
  }
}
