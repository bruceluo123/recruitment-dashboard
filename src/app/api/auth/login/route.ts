import { NextRequest, NextResponse } from 'next/server';
import {
  createSessionToken,
  normalizeOwners,
  passwordUsers,
  REMEMBER_SESSION_MAX_AGE_SECONDS,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  sessionSecrets,
  verifyPassword,
} from '@/lib/auth-core';
import { clientIp, rateLimit, sameOriginGuard } from '@/lib/api-guard';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const originBlocked = sameOriginGuard(request);
  if (originBlocked) return originBlocked;
  if (!rateLimit(`login:${clientIp(request)}`, 10, 15 * 60_000)) {
    return NextResponse.json({ error: '尝试次数过多，请稍后再试' }, { status: 429 });
  }
  const users = passwordUsers();
  const secret = sessionSecrets()[0];
  if (!users.length || !secret) {
    return NextResponse.json({ error: '登录服务尚未配置' }, { status: 503 });
  }
  try {
    const body = await request.json() as { username?: string; password?: string; rememberMe?: boolean };
    const username = String(body.username || '').trim().toLowerCase();
    const password = String(body.password || '');
    const user = users.find((item) => item.username.trim().toLowerCase() === username);
    if (!user || password.length > 256 || !await verifyPassword(password, user)) {
      return NextResponse.json({ error: '账号或密码不正确' }, { status: 401 });
    }
    const owners = normalizeOwners(user.owners);
    if (!owners.length) {
      return NextResponse.json({ error: '该账号尚未分配所属人权限' }, { status: 403 });
    }
    const maxAge = body.rememberMe === true ? REMEMBER_SESSION_MAX_AGE_SECONDS : SESSION_MAX_AGE_SECONDS;
    const token = await createSessionToken({ sub: user.id, name: user.name, owners }, secret, maxAge);
    const response = NextResponse.json({ ok: true, user: { id: user.id, name: user.name, owners } });
    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge,
    });
    return response;
  } catch {
    return NextResponse.json({ error: '登录请求无效' }, { status: 400 });
  }
}
