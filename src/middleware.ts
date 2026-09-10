import { NextRequest, NextResponse } from 'next/server';
import {
  secureStringEqual,
  SESSION_COOKIE,
  sessionSecrets,
  verifySessionToken,
} from '@/lib/auth-core';

const PUBLIC_PATHS = new Set(['/login', '/api/auth/login']);

function validBearer(request: NextRequest): boolean {
  const authorization = request.headers.get('authorization') || '';
  if (!authorization.startsWith('Bearer ')) return false;
  const supplied = authorization.slice(7);
  const serviceToken = process.env.SERVICE_API_TOKEN || '';
  const cronSecret = process.env.CRON_SECRET || '';
  return (!!serviceToken && secureStringEqual(supplied, serviceToken))
    || (!!cronSecret && request.nextUrl.pathname.endsWith('-cron') && secureStringEqual(supplied, cronSecret));
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();
  if (pathname === '/api/auth/logout') return NextResponse.next();
  if (pathname.startsWith('/api/') && validBearer(request)) return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE)?.value || '';
  if (token && await verifySessionToken(token, sessionSecrets())) return NextResponse.next();

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: '未授权，请先登录' }, { status: 401 });
  }
  const loginUrl = new URL('/login', request.url);
  const next = `${pathname}${search}`;
  if (next.startsWith('/') && !next.startsWith('//')) loginUrl.searchParams.set('next', next);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2)$).*)'],
};
