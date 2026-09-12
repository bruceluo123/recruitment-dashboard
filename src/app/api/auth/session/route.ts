import { NextRequest, NextResponse } from 'next/server';
import { apiSessionUser, effectiveOwners } from '@/lib/auth-api';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const user = await apiSessionUser(request);
  if (!user) return NextResponse.json({ error: '未授权，请先登录' }, { status: 401 });
  return NextResponse.json({
    ok: true,
    user: { id: user.sub, name: user.name, owners: effectiveOwners(user.owners) },
  }, { headers: { 'Cache-Control': 'no-store' } });
}
