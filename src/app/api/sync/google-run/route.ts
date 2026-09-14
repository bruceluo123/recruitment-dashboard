import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// 完整面板覆盖是岗位库的唯一权威来源。旧 Google 源永久禁用，避免历史岗位回灌。
export async function POST() {
  return NextResponse.json(
    { ok: false, error: '旧岗位源已停用，请使用完整面板覆盖导入' },
    { status: 410 },
  );
}
