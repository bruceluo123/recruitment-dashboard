import { NextRequest, NextResponse } from 'next/server';
import { guardApi } from '@/lib/api-guard';
import { requireOwnerSession } from '@/lib/auth-api';
import { kvCommandStrict } from '@/lib/kv-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface DialogCache {
  updatedAt: string;
  items: Array<{ id: string; target: string; title: string; username: string; type: string }>;
}

function parseCache(value: DialogCache | string | null): DialogCache | null {
  if (!value) return null;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value) as DialogCache; } catch { return null; }
}

export async function GET(request: NextRequest) {
  const sender = request.nextUrl.searchParams.get('sender') === 'b' ? 'b' : 'a';
  const unauthorized = await requireOwnerSession(request, sender);
  if (unauthorized) return unauthorized;
  const blocked = guardApi(request, 'tg-dialogs', 12, 60_000);
  if (blocked) return blocked;

  const cacheKey = sender === 'b' ? 'recruit:tg-delivery-dialogs-b' : 'recruit:tg-delivery-dialogs';
  try {
    const cache = parseCache(await kvCommandStrict<DialogCache | string | null>('GET', cacheKey));
    return NextResponse.json({
      ok: true,
      items: Array.isArray(cache?.items) ? cache.items : [],
      updatedAt: cache?.updatedAt || '',
    });
  } catch {
    return NextResponse.json({ ok: false, error: 'TG 会话列表读取失败' }, { status: 503 });
  }
}
