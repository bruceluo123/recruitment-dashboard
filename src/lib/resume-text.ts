// 简历文字提取（PDF / DOCX）共享实现：被 /api/resume/parse 与 /api/talent/scan 复用。
import { extractPdfTextViaGemini } from '@/lib/ocr-gemini';

export interface ExtractOk { text: string; source: string; }
export interface ExtractErr { error: string; }
export type ExtractResult = ExtractOk | ExtractErr;

export function isExtractErr(r: ExtractResult): r is ExtractErr {
  return (r as ExtractErr).error !== undefined;
}

/** 折叠空白后估算有效正文字数 */
export function meaningfulLength(text: string): number {
  return text.replace(/\s+/g, '').length;
}

/** 图片型/混合型 PDF 文字层稀疏（平均每页 < 350 字）时需走 OCR */
function isTextLayerSparse(text: string, numPages: number): boolean {
  const pages = Math.max(1, numPages || 1);
  return meaningfulLength(text) < pages * 350;
}

async function extractPdf(buffer: Buffer): Promise<ExtractResult> {
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

  const geminiKey = process.env.GEMINI_API_KEY;
  if (isTextLayerSparse(pdfText, numPages) && geminiKey) {
    try {
      const ocrText = await extractPdfTextViaGemini(buffer, geminiKey);
      if (meaningfulLength(ocrText) > meaningfulLength(pdfText)) {
        return { text: ocrText, source: 'gemini-ocr' };
      }
    } catch {
      // OCR 失败 → 回退到 pdf-parse 结果
    }
  }

  if (meaningfulLength(pdfText) > 0) return { text: pdfText, source: 'pdf-text' };

  return {
    error: geminiKey
      ? 'PDF 解析失败，请尝试上传 DOCX 格式或复制粘贴简历文本'
      : '该 PDF 为图片型（扫描件），暂无法识别。请配置 GEMINI_API_KEY 启用图片识别，或上传 DOCX / 粘贴文本',
  };
}

/** 从文件 buffer 提取简历正文。仅支持 PDF / DOCX。 */
export async function extractResumeText(buffer: Buffer, fileName: string): Promise<ExtractResult> {
  const lower = (fileName || '').toLowerCase();
  if (lower.endsWith('.pdf')) return extractPdf(buffer);
  if (lower.endsWith('.docx')) {
    try {
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ buffer });
      return { text: result.value, source: 'docx' };
    } catch {
      return { error: 'DOCX 解析失败，请尝试复制粘贴简历文本' };
    }
  }
  if (lower.endsWith('.doc')) return { error: '.doc 旧格式暂不支持，请转为 PDF / DOCX' };
  return { error: '仅支持 PDF / DOCX 格式' };
}
