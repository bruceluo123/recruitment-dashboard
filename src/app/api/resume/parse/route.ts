import { NextRequest, NextResponse } from 'next/server';
import { extractResumeText, isExtractErr } from '@/lib/resume-text';
import { blobUrlError } from '@/lib/api-guard';

export const runtime = 'nodejs';
export const maxDuration = 60;
const MAX_FILE_BYTES = 50 * 1024 * 1024;

async function downloadResume(url: string): Promise<Buffer> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(Object.assign(new Error('附件下载超时，请重试；已上传附件无需重新上传'), { status: 504 }));
        controller.abort();
      }, 10_000);
    });
    try {
      return await Promise.race([(async () => {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw Object.assign(new Error(`附件下载失败 (${res.status})，请重试`), {
          status: 502, retryable: res.status >= 500 || [408, 429].includes(res.status),
        });
        if (Number(res.headers.get('content-length') || 0) > MAX_FILE_BYTES) {
          controller.abort();
          throw Object.assign(new Error('简历超过 50MB，请压缩后重试'), { status: 413, retryable: false });
        }
        const reader = res.body?.getReader();
        let buffer: Buffer;
        if (reader) {
          const chunks: Uint8Array[] = [];
          let length = 0;
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              length += value.byteLength;
              if (length > MAX_FILE_BYTES) {
                controller.abort();
                throw Object.assign(new Error('简历超过 50MB，请压缩后重试'), { status: 413, retryable: false });
              }
              chunks.push(value);
            }
          } finally { void reader.cancel().catch(() => {}); }
          buffer = Buffer.concat(chunks);
        } else buffer = Buffer.from(await res.arrayBuffer());
        if (!buffer.length || buffer.length > MAX_FILE_BYTES) throw Object.assign(
          new Error(buffer.length ? '简历超过 50MB，请压缩后重试' : '简历文件为空，请重新选择'),
          { status: buffer.length ? 413 : 400, retryable: false },
        );
        return buffer;
      })(), deadline]);
    } catch (error) {
      if (attempt === 1 || (error as { retryable?: boolean }).retryable === false) throw error;
    } finally { clearTimeout(timer!); }
  }
  throw new Error('附件下载失败，请重试');
}

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type') || '';

    // 路径 A：大文件经 Vercel Blob 客户端直传后，前端发来 {url, fileName} —— 服务端拉取再解析，
    // 绕过 Serverless 4.5MB 请求体上限（作品集/扫描型大 PDF 必经此路径）。
    if (contentType.includes('application/json')) {
      const { url, fileName } = (await request.json()) as { url?: string; fileName?: string };
      if (!url || typeof url !== 'string') return NextResponse.json({ error: '缺少文件 URL' }, { status: 400 });
      if (fileName !== undefined && typeof fileName !== 'string') return NextResponse.json({ error: '文件名格式无效' }, { status: 400 });
      const urlErr = blobUrlError(url);
      if (urlErr) return NextResponse.json({ error: urlErr }, { status: 400 });

      let buffer: Buffer;
      try {
        buffer = await downloadResume(url);
      } catch (err) {
        const error = err as Error & { status?: number };
        return NextResponse.json({ error: error.status ? error.message : '附件下载中断，请重试；已上传附件仍保留' }, { status: error.status || 502 });
      }

      const out = await extractResumeText(buffer, fileName || url);
      if (isExtractErr(out)) return NextResponse.json({ error: out.error }, { status: 422 });
      return NextResponse.json({ text: out.text, fileName: fileName || '', source: out.source });
    }

    // 路径 B：小文件直接以 FormData 上传（快路径）。
    const formData = await request.formData();
    const file = formData.get('file') as File;
    if (!file || typeof file.arrayBuffer !== 'function') return NextResponse.json({ error: '请选择简历文件' }, { status: 400 });
    if (!file.size || file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: file.size ? '简历超过 50MB，请压缩后重试' : '简历文件为空，请重新选择' }, { status: file.size ? 413 : 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    if (!buffer.length || buffer.length > MAX_FILE_BYTES) {
      return NextResponse.json({ error: buffer.length ? '简历超过 50MB，请压缩后重试' : '简历文件为空，请重新选择' }, { status: buffer.length ? 413 : 400 });
    }
    const out = await extractResumeText(buffer, file.name);
    if (isExtractErr(out)) return NextResponse.json({ error: out.error }, { status: 422 });

    return NextResponse.json({ text: out.text, fileName: file.name, source: out.source });
  } catch (err) {
    return NextResponse.json({ error: `上传失败: ${(err as Error).message}` }, { status: 500 });
  }
}
