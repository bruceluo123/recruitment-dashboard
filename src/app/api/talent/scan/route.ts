import { NextRequest, NextResponse } from 'next/server';
import { extractResumeText, isExtractErr } from '@/lib/resume-text';
import { kvSetRaw, kvConfigured, talentTextKey } from '@/lib/kv-server';
import { blobUrlError } from '@/lib/api-guard';

export const runtime = 'nodejs';
export const maxDuration = 60;

// POST /api/talent/scan {id, url, fileName}
// 拉取 Blob 简历 → 提取文字 → 存入 KV(recruit:talent-text:<id>) → 返回 {id, chars, source}
export async function POST(request: NextRequest) {
  if (!kvConfigured()) return NextResponse.json({ error: 'KV 未配置' }, { status: 503 });
  try {
    const { id, url, fileName } = (await request.json()) as { id?: string; url?: string; fileName?: string };
    if (!id || !url) return NextResponse.json({ error: '参数缺失 (id/url)' }, { status: 400 });
    const urlErr = blobUrlError(url);
    if (urlErr) return NextResponse.json({ error: urlErr }, { status: 400 });

    let buffer: Buffer;
    try {
      const res = await fetch(url);
      if (!res.ok) return NextResponse.json({ error: `简历下载失败 (${res.status})` }, { status: 502 });
      buffer = Buffer.from(await res.arrayBuffer());
    } catch (err) {
      return NextResponse.json({ error: `简历下载失败: ${(err as Error).message}` }, { status: 502 });
    }

    const out = await extractResumeText(buffer, fileName || url);
    if (isExtractErr(out)) return NextResponse.json({ id, error: out.error }, { status: 422 });

    const saved = await kvSetRaw(talentTextKey(id), out.text);
    if (!saved) return NextResponse.json({ id, error: '文字存储失败' }, { status: 500 });

    return NextResponse.json({ id, chars: out.text.replace(/\s+/g, '').length, source: out.source });
  } catch (err) {
    return NextResponse.json({ error: `扫描失败: ${(err as Error).message}` }, { status: 500 });
  }
}
