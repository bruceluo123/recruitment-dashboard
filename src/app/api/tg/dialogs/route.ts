import { NextRequest, NextResponse } from 'next/server';
import { guardApi } from '@/lib/api-guard';
import { kvGet } from '@/lib/kv';

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
  const blocked = guardApi(request, 'tg-dialogs', 12, 60_000);
  if (blocked) return blocked;

  const cache = parseCache(await kvGet<DialogCache | string>('recruit:tg-delivery-dialogs'));
  return NextResponse.json({
    ok: true,
    items: Array.isArray(cache?.items) ? cache.items : [],
    updatedAt: cache?.updatedAt || '',
  });
}
