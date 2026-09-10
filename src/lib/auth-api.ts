import { NextRequest, NextResponse } from 'next/server';
import { secureStringEqual, SESSION_COOKIE, sessionSecrets, verifySessionToken, type OwnerId, type SessionUser } from '@/lib/auth-core';
import { sameOriginGuard } from '@/lib/api-guard';

export function hasValidServiceToken(request: NextRequest): boolean {
  const serviceToken = process.env.SERVICE_API_TOKEN || '';
  const authorization = request.headers.get('authorization') || '';
  return !!serviceToken && authorization.startsWith('Bearer ')
    && secureStringEqual(authorization.slice(7), serviceToken);
}

export async function apiSessionUser(request: NextRequest): Promise<SessionUser | null> {
  const token = request.cookies.get(SESSION_COOKIE)?.value || '';
  return token ? verifySessionToken(token, sessionSecrets()) : null;
}

export async function permittedOwners(request: NextRequest): Promise<OwnerId[] | null> {
  if (hasValidServiceToken(request)) return ['a', 'b'];
  return (await apiSessionUser(request))?.owners || null;
}

export async function requireApiSession(request: NextRequest): Promise<NextResponse | null> {
  if (hasValidServiceToken(request)) return null;

  if (await apiSessionUser(request)) return null;
  return NextResponse.json({ error: '未授权，请先登录' }, { status: 401 });
}

export async function requireOwnerSession(
  request: NextRequest,
  owner: OwnerId,
  mutation = false,
): Promise<NextResponse | null> {
  if (hasValidServiceToken(request)) return null;
  const user = await apiSessionUser(request);
  if (!user) return NextResponse.json({ error: '未授权，请先登录' }, { status: 401 });
  if (!user.owners.includes(owner)) return NextResponse.json({ error: '无权访问该所属人的数据' }, { status: 403 });
  return mutation ? sameOriginGuard(request) : null;
}

export async function requireMutationSession(request: NextRequest): Promise<NextResponse | null> {
  const unauthorized = await requireApiSession(request);
  if (unauthorized) return unauthorized;
  return hasValidServiceToken(request) ? null : sameOriginGuard(request);
}
