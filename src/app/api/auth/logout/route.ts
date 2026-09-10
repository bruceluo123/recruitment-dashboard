import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth-core';
import { sameOriginGuard } from '@/lib/api-guard';

export async function POST(request: NextRequest) {
  const blocked = sameOriginGuard(request);
  if (blocked) return blocked;
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
  return response;
}
