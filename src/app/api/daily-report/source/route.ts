import { NextRequest, NextResponse } from 'next/server';
import { permittedOwners, requireApiSession } from '@/lib/auth-api';
import { filterAccessibleRecords } from '@/lib/data-ownership';
import { kvDailyReportSource, StorageQuotaError } from '@/lib/kv-server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const unauthorized = await requireApiSession(request);
  if (unauthorized) return unauthorized;
  const owners = await permittedOwners(request);
  if (!owners) return NextResponse.json({ error: '未授权，请先登录' }, { status: 401 });

  const day = request.nextUrl.searchParams.get('date') || '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(Date.parse(`${day}T12:00:00Z`))) {
    return NextResponse.json({ error: '日报日期无效' }, { status: 400 });
  }

  try {
    const source = await kvDailyReportSource(day);
    if (!Array.isArray(source.items) || !Array.isArray(source.candidates)) throw new Error('日报数据格式异常');
    const tombstones = source.tombstones && typeof source.tombstones === 'object' && !Array.isArray(source.tombstones)
      ? source.tombstones as Record<string, Record<string, unknown>> : {};
    const items = (filterAccessibleRecords('repush', source.items, owners) as Array<Record<string, unknown>>)
      .filter((item) => !tombstones.repush?.[String(item.id || '')]
        && !tombstones.repush?.[String(item.applicationId || '')]);
    const candidates = (filterAccessibleRecords('candidates', source.candidates, owners) as Array<Record<string, unknown>>)
      .filter((candidate) => !tombstones.candidates?.[String(candidate.id || '')]);
    return NextResponse.json({ items, candidates }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof StorageQuotaError) return NextResponse.json({ error: error.message }, { status: 402 });
    return NextResponse.json({ error: '日报云端数据读取失败，原有数据未更改' }, { status: 503 });
  }
}
