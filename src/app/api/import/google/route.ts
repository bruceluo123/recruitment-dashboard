import { NextRequest, NextResponse } from 'next/server';
import { fetchGoogleExport } from '@/lib/google-sheet';

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json() as { url?: string };
    const { buffer, type } = await fetchGoogleExport(String(url ?? ''));
    return buildFileResponse(buffer, type);
  } catch (err) {
    const msg = (err as Error).message || '未知错误';
    // 权限/格式类错误返回 4xx，其余 500
    const status = /仅支持|私有|访问权限/.test(msg) ? 403 : 500;
    return NextResponse.json({ error: `导入失败: ${msg}` }, { status });
  }
}

function buildFileResponse(buffer: ArrayBuffer, type: 'sheet' | 'doc'): NextResponse {
  const isDoc = type === 'doc';
  return new NextResponse(buffer, {
    headers: {
      'Content-Type': isDoc ? 'text/plain; charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="google-import.${isDoc ? 'txt' : 'xlsx'}"`,
    },
  });
}
