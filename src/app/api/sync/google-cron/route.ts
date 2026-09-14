import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
// 即使旧定时地址被误调用，也不允许历史岗位重新写入。
export async function GET() {
  return NextResponse.json(
    { ok: false, error: '旧岗位源已停用' },
    { status: 410 },
  );
}
