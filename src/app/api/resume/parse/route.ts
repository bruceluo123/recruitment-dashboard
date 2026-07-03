import { NextRequest, NextResponse } from 'next/server';
import { extractResumeText, isExtractErr } from '@/lib/resume-text';
import { blobUrlError } from '@/lib/api-guard';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type') || '';

    // 路径 A：大文件经 Vercel Blob 客户端直传后，前端发来 {url, fileName} —— 服务端拉取再解析，
    // 绕过 Serverless 4.5MB 请求体上限（作品集/扫描型大 PDF 必经此路径）。
    if (contentType.includes('application/json')) {
      const { url, fileName } = (await request.json()) as { url?: string; fileName?: string };
      if (!url) return NextResponse.json({ error: '缺少文件 URL' }, { status: 400 });
      const urlErr = blobUrlError(url);
      if (urlErr) return NextResponse.json({ error: urlErr }, { status: 400 });

      let buffer: Buffer;
      try {
        const res = await fetch(url);
        if (!res.ok) return NextResponse.json({ error: `文件下载失败 (${res.status})` }, { status: 502 });
        buffer = Buffer.from(await res.arrayBuffer());
      } catch (err) {
        return NextResponse.json({ error: `文件下载失败: ${(err as Error).message}` }, { status: 502 });
      }

      const out = await extractResumeText(buffer, fileName || url);
      if (isExtractErr(out)) return NextResponse.json({ error: out.error }, { status: 422 });
      return NextResponse.json({ text: out.text, fileName: fileName || '', source: out.source });
    }

    // 路径 B：小文件直接以 FormData 上传（快路径）。
    const formData = await request.formData();
    const file = formData.get('file') as File;
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const out = await extractResumeText(buffer, file.name);
    if (isExtractErr(out)) return NextResponse.json({ error: out.error }, { status: 422 });

    return NextResponse.json({ text: out.text, fileName: file.name, source: out.source });
  } catch (err) {
    return NextResponse.json({ error: `上传失败: ${(err as Error).message}` }, { status: 500 });
  }
}
