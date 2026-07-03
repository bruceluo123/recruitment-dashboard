import { NextRequest, NextResponse } from 'next/server';
import { runTgSync, type TgSyncSummary } from '@/lib/tg-sync';
import { sameOriginGuard, rateLimit } from '@/lib/api-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function errBody(error: string): TgSyncSummary {
  return { ok: false, updated: 0, tgEntries: 0, messages: 0, total: 0, error };
}

// 手动触发 TG 缺口同步（「同步 TG 缺口」按钮）。仅放行浏览器同域调用，并做 30 秒节流，
// 防止外部脚本滥用真实 TG 账号 session 导致限流/封号。
export async function POST(req: NextRequest): Promise<NextResponse<TgSyncSummary>> {
  const blocked = sameOriginGuard(req);
  if (blocked) return blocked;
  if (!rateLimit('sync:tg', 1, 30_000)) {
    return NextResponse.json(errBody('同步过于频繁，请 30 秒后再试'), { status: 429 });
  }
  try {
    const summary = await runTgSync();
    return NextResponse.json(summary);
  } catch (err) {
    return NextResponse.json(errBody((err as Error).message || 'TG 同步失败'), { status: 500 });
  }
}
