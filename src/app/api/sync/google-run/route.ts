import { NextRequest, NextResponse } from 'next/server';
import { runGoogleSync, type SyncSummary } from '@/lib/google-sync';
import { sameOriginGuard, rateLimit } from '@/lib/api-guard';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// 手动触发同步（"立即同步"按钮）。仅放行浏览器同域调用，并做 30 秒节流，
// 防止外部脚本触发或误连点导致 Google Sheets 配额浪费与数据抖动。
export async function POST(req: NextRequest): Promise<NextResponse<SyncSummary>> {
  const blocked = sameOriginGuard(req);
  if (blocked) return blocked;
  if (!rateLimit('sync:google', 1, 30_000)) {
    return NextResponse.json(
      { ok: false, added: 0, deleted: 0, updated: 0, adopted: 0, kept: 0, total: 0, error: '同步过于频繁，请 30 秒后再试' },
      { status: 429 },
    );
  }
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
