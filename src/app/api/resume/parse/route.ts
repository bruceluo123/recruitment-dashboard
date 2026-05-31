import { NextRequest, NextResponse } from 'next/server';
import { extractPdfTextViaGemini } from '@/lib/ocr-gemini';

export const runtime = 'nodejs';
export const maxDuration = 60;

/** 折叠 pdf-parse 常见的「逐字符换行」，估算有效正文字数。 */
function meaningfulLength(text: string): number {
  return text.replace(/\s+/g, '').length;
}

/**
 * 判断 pdf-parse 的文字层是否「足够完整」。
 * 图片型/混合型 PDF（扫描件、图片嵌入）文字层稀疏，需走 Gemini OCR 补全。
 * 阈值：平均每页有效正文 < 350 字 → 视为不完整。
 */
function isTextLayerSparse(text: string, numPages: number): boolean {
  const pages = Math.max(1, numPages || 1);
  return meaningfulLength(text) < pages * 350;
}

async function parsePdf(buffer: Buffer, fileName: string): Promise<NextResponse> {
  let pdfText = '';
  let numPages = 1;
  try {
    const pdfParse = (await import('pdf-parse-debugging-disabled')).default;
    const data = await pdfParse(buffer);
    pdfText = data.text || '';
    numPages = data.numpages || 1;
  } catch {
    pdfText = '';
  }

  const sparse = isTextLayerSparse(pdfText, numPages);
  const geminiKey = process.env.GEMINI_API_KEY;

  // 文字层不完整（图片型）且配置了视觉模型 → 用 Gemini OCR 读全文
  if (sparse && geminiKey) {
    try {
      const ocrText = await extractPdfTextViaGemini(buffer, geminiKey);
      if (meaningfulLength(ocrText) > meaningfulLength(pdfText)) {
        return NextResponse.json({ text: ocrText, fileName, source: 'gemini-ocr' });
      }
    } catch {
      // OCR 失败则回退到 pdf-parse 的结果（可能不完整）
    }
  }

  if (meaningfulLength(pdfText) > 0) {
    return NextResponse.json({ text: pdfText, fileName, source: 'pdf-text' });
  }

  // 既无文字层、又无可用 OCR
  const hint = geminiKey
    ? 'PDF 解析失败，请尝试上传 DOCX 格式或复制粘贴简历文本'
    : '该 PDF 为图片型（扫描件），暂无法识别。请配置 GEMINI_API_KEY 启用图片识别，或上传 DOCX / 粘贴文本';
  return NextResponse.json({ error: hint }, { status: 422 });
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());
    const fileName = file.name.toLowerCase();

    if (fileName.endsWith('.pdf')) {
      return await parsePdf(buffer, file.name);
    }

    if (fileName.endsWith('.docx')) {
      try {
        const mammoth = await import('mammoth');
        const result = await mammoth.extractRawText({ buffer });
        return NextResponse.json({ text: result.value, fileName: file.name, source: 'docx' });
      } catch {
        return NextResponse.json({ error: 'DOCX 解析失败，请尝试复制粘贴简历文本' }, { status: 500 });
      }
    }

    return NextResponse.json({ error: '仅支持 PDF / DOCX 格式' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: `上传失败: ${(err as Error).message}` }, { status: 500 });
  }
}
