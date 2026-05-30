import { NextRequest, NextResponse } from 'next/server';
import { runTgSync, type TgSyncSummary } from '@/lib/tg-sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function errBody(error: string): TgSyncSummary {
  return { ok: false, matched: 0, cleared: 0, p0: 0, p1: 0, tgEntries: 0, messages: 0, total: 0, error };
}

export async function GET(req: NextRequest): Promise<NextResponse<TgSyncSummary>> {
  // Vercel Cron 会带上 Authorization: Bearer ${CRON_SECRET}（若已配置）
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json(errBody('Unauthorized'), { status: 401 });
  }

  try {
    const summary = await runTgSync();
    return NextResponse.json(summary);
  } catch (err) {
    return NextResponse.json(errBody((err as Error).message || 'TG 同步失败'), { status: 500 });
  }
}
