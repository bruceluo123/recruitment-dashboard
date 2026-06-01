import { NextResponse } from 'next/server';
import { runTgSync, type TgSyncSummary } from '@/lib/tg-sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function errBody(error: string): TgSyncSummary {
  return { ok: false, updated: 0, tgEntries: 0, messages: 0, total: 0, error };
}

// 手动触发 TG 缺口同步（无需 CRON_SECRET）。用于「同步 TG 缺口」按钮。
export async function POST(): Promise<NextResponse<TgSyncSummary>> {
  try {
    const summary = await runTgSync();
    return NextResponse.json(summary);
  } catch (err) {
    return NextResponse.json(errBody((err as Error).message || 'TG 同步失败'), { status: 500 });
  }
}
