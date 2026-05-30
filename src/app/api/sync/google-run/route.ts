import { NextResponse } from 'next/server';
import { runGoogleSync, type SyncSummary } from '@/lib/google-sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// 手动触发同步（无需 CRON_SECRET）。用于"立即同步"按钮，
// 以及对源表"优先级/缺口/内容"变更的即时回填。
export async function POST(): Promise<NextResponse<SyncSummary>> {
  try {
    const summary = await runGoogleSync();
    return NextResponse.json(summary);
  } catch (err) {
    return NextResponse.json(
      { ok: false, added: 0, deleted: 0, updated: 0, adopted: 0, kept: 0, total: 0, error: (err as Error).message || '同步失败' },
      { status: 500 },
    );
  }
}
