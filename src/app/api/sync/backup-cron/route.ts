import { NextRequest, NextResponse } from 'next/server';
import { runBackup, type BackupSummary } from '@/lib/backup-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function errBody(error: string): BackupSummary {
  return { ok: false, date: '', results: [], pruned: 0, error };
}

export async function GET(req: NextRequest): Promise<NextResponse<BackupSummary>> {
  // Vercel Cron 会带 Authorization: Bearer ${CRON_SECRET}（若已配置）。手动触发同样可用。
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json(errBody('Unauthorized'), { status: 401 });
  }

  try {
    const summary = await runBackup();
    return NextResponse.json(summary);
  } catch (err) {
    return NextResponse.json(errBody((err as Error).message || '备份失败'), { status: 500 });
  }
}
