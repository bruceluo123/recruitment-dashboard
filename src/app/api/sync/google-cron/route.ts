import { NextRequest, NextResponse } from 'next/server';
import { runGoogleSync, type SyncSummary } from '@/lib/google-sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest): Promise<NextResponse<SyncSummary>> {
  // Vercel Cron 会带上 Authorization: Bearer ${CRON_SECRET}（若已配置）
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json(
      { ok: false, added: 0, deleted: 0, updated: 0, adopted: 0, kept: 0, total: 0, error: 'Unauthorized' },
      { status: 401 },
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
