import { NextRequest, NextResponse } from 'next/server';
import { extractResumeText, isExtractErr } from '@/lib/resume-text';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
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
