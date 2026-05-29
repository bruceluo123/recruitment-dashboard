import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';

export const dynamic = 'force-dynamic';

// 上传简历文件到 Vercel Blob，返回可下载的公开链接
export async function POST(request: NextRequest) {
  try {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return NextResponse.json(
        { error: '云端文件存储未配置（缺少 BLOB_READ_WRITE_TOKEN），请在 Vercel 项目中关联 Blob Store' },
        { status: 500 },
      );
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) return NextResponse.json({ error: '未提供文件' }, { status: 400 });

    const safeName = file.name.replace(/[^\w.\u4e00-\u9fa5-]/g, '_');
    const pathname = `resumes/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;

    const blob = await put(pathname, file, {
      access: 'public',
      contentType: file.type || 'application/octet-stream',
    });

    return NextResponse.json({
      url: blob.url,
      downloadUrl: blob.downloadUrl,
      fileName: file.name,
    });
  } catch (err) {
    return NextResponse.json({ error: `上传失败: ${(err as Error).message}` }, { status: 500 });
  }
}
