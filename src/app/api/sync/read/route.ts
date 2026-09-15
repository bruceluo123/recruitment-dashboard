import { NextRequest, NextResponse } from 'next/server';
import { kvCommandStrict } from '@/lib/kv-server';
import { permittedOwners, requireApiSession } from '@/lib/auth-api';
import { filterAccessibleRecords } from '@/lib/data-ownership';
import { getBuiltinRequestContext } from 'next/dist/server/lib/builtin-request-context';
import { projectTgDeliveryRecords } from '@/lib/tg-delivery-projection';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const KEYS: Record<string, string> = Object.fromEntries([
  'jds', 'jds-epoch', 'candidates', 'talents', 'repush', 'todos', 'companies', 'performance', 'version', 'tombstones', 'last-import-diff', 'weekly-added',
].map((key) => [key, `recruit:${key}`]));
export async function GET(request: NextRequest) {
  const unauthorized = await requireApiSession(request);
  if (unauthorized) return unauthorized;
  const owners = await permittedOwners(request);
  if (!owners) return NextResponse.json({ error: '未授权，请先登录' }, { status: 401 });
  const keys = request.nextUrl.searchParams.getAll('key');
  if (!keys.length || keys.length > 10 || keys.some((key) => !Object.hasOwn(KEYS, key))) return NextResponse.json({ error: '读取范围无效' }, { status: 400 });
  const projection = keys.includes('repush') || keys.includes('version')
    ? projectTgDeliveryRecords().catch(() => undefined) : undefined;
  const waitUntil = getBuiltinRequestContext()?.waitUntil;
  if (projection && waitUntil) waitUntil(projection);
  try {
    const values = await kvCommandStrict<(string | null)[]>('MGET', ...keys.map((key) => KEYS[key]));
    // Vercel keeps the projection alive after responding; local runtimes await the
    // same concurrent work rather than launching an untracked background promise.
    if (projection && !waitUntil) await projection;
    const visibleValues = values.map((value, index) => {
      const key = keys[index];
      if (!['candidates', 'repush', 'todos', 'performance'].includes(key) || !value) return value;
      const parsed = JSON.parse(value) as unknown;
      // 推荐中心及周报允许两个账号交叉查看推荐、面试、Offer 与入职数据；
      // 这里只放宽读取，记录修改仍由 /api/sync/records 按所属人校验。
      const readableOwners = key === 'repush' || key === 'candidates' ? ['a', 'b'] as const : owners;
      return JSON.stringify(filterAccessibleRecords(key, parsed, [...readableOwners]));
    });
    return NextResponse.json({ values: Object.fromEntries(keys.map((key, index) => [key, visibleValues[index]])) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: '数据读取失败，保留上次结果' }, { status: 503 });
  }
}
