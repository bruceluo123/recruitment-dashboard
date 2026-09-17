import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession } from '@/lib/auth-api';
import { filterAccessibleRecords } from '@/lib/data-ownership';
import { kvCommandStrict } from '@/lib/kv-server';

export const dynamic = 'force-dynamic';

interface CandidateRecord {
  id: string;
  [key: string]: unknown;
}

function parseCandidates(raw: string | null): CandidateRecord[] {
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('candidate history is invalid');
  return parsed.filter((item): item is CandidateRecord => Boolean(
    item && typeof item === 'object' && !Array.isArray(item) && typeof (item as CandidateRecord).id === 'string',
  ));
}

/** Excel 看板读取完整历史；删除标记只隐藏业务卡片，不抹掉已经发生的面试。 */
export async function GET(request: NextRequest) {
  const unauthorized = await requireApiSession(request);
  if (unauthorized) return unauthorized;
  try {
    const [liveRaw, backupRaw] = await kvCommandStrict<(string | null)[]>(
      'MGET',
      'recruit:candidates',
      'recruit:backup:candidates:latest',
    );
    const merged = new Map<string, CandidateRecord>();
    for (const candidate of parseCandidates(backupRaw)) merged.set(candidate.id, candidate);
    for (const candidate of parseCandidates(liveRaw)) merged.set(candidate.id, candidate);
    // 与推荐中心一致，两个招聘账号可以交叉查看面试与 Offer 流水。
    const candidates = filterAccessibleRecords('candidates', Array.from(merged.values()), ['a', 'b']);
    return NextResponse.json({ candidates }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: '历史面试读取失败，请稍后重试' }, { status: 503 });
  }
}
