import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const fileName = file.name.toLowerCase();

    if (fileName.endsWith('.pdf')) {
      try {
        const pdfParse = (await import('pdf-parse-debugging-disabled')).default;
        const data = await pdfParse(buffer);
        return NextResponse.json({ text: data.text, fileName: file.name });
      } catch {
        return NextResponse.json({ error: 'PDF 解析失败，请尝试上传 DOCX 格式或复制粘贴简历文本' }, { status: 500 });
      }
    }

    if (fileName.endsWith('.docx')) {
      try {
        const mammoth = await import('mammoth');
        const result = await mammoth.extractRawText({ buffer });
        return NextResponse.json({ text: result.value, fileName: file.name });
      } catch {
        return NextResponse.json({ error: 'DOCX 解析失败，请尝试复制粘贴简历文本' }, { status: 500 });
      }
    }

    return NextResponse.json({ error: '仅支持 PDF / DOCX 格式' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: `上传失败: ${(err as Error).message}` }, { status: 500 });
  }
}
