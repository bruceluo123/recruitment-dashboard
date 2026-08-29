// 简历文字提取（PDF / DOC / DOCX / 图片）共享实现：被 /api/resume/parse 与 /api/talent/scan 复用。
import { extractPdfTextViaGemini } from '@/lib/ocr-gemini';
import { extractImageTextViaDeepSeek, isSupportedVisionImage } from '@/lib/ocr-deepseek-vision';

export interface ExtractOk { text: string; source: string; }
export interface ExtractErr { error: string; }
export type ExtractResult = ExtractOk | ExtractErr;

export function isExtractErr(r: ExtractResult): r is ExtractErr {
  return (r as ExtractErr).error !== undefined;
}

// 存储上限：匹配只需「大概」内容（实际喂 AI 时还会裁到 ~1200 字），
// 超长正文截断以控制 KV 体积、支撑 2000 份规模。
const MAX_STORED_CHARS = 8000;
function clipForStorage(text: string): string {
  return text.length > MAX_STORED_CHARS ? text.slice(0, MAX_STORED_CHARS) : text;
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

function decodeHtmlEntities(text: string): string {
  const named: Record<string, string> = {
    amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"',
  };
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, code: string) => {
    if (code[0] !== '#') return named[code.toLowerCase()] ?? entity;
    const value = code[1]?.toLowerCase() === 'x'
      ? Number.parseInt(code.slice(2), 16)
      : Number.parseInt(code.slice(1), 10);
    return Number.isFinite(value) ? String.fromCodePoint(value) : entity;
  });
}

function extractWordHtml(buffer: Buffer): string {
  const header = buffer.subarray(0, Math.min(buffer.length, 4096)).toString('ascii');
  const charset = header.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1]?.toLowerCase() || 'utf-8';
  const encoding = charset === 'gb2312' || charset === 'gbk' ? 'gb18030' : charset;
  let html: string;
  try {
    html = new TextDecoder(encoding).decode(buffer);
  } catch {
    html = new TextDecoder('utf-8').decode(buffer);
  }

  const bodyStart = html.search(/<body\b/i);
  if (bodyStart >= 0) {
    const contentStart = html.indexOf('>', bodyStart);
    const bodyEnd = html.search(/<\/body\s*>/i);
    html = html.slice(contentStart + 1, bodyEnd > contentStart ? bodyEnd : undefined);
  }

  return decodeHtmlEntities(html)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(?:br|hr)\b[^>]*>/gi, '\n')
    .replace(/<\/(?:div|h[1-6]|li|p|table|tr)>/gi, '\n')
    .replace(/<\/(?:td|th)>/gi, '\t')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[\t ]+\n/g, '\n')
    .replace(/\n[\t ]+/g, '\n')
    .replace(/[\t ]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function extractPdf(buffer: Buffer): Promise<ExtractResult> {
  let pdfText = '';
  let numPages = 1;
  let pdfParseError = '';
  try {
    const pdfParse = (await import('pdf-parse-debugging-disabled')).default;
    const data = await pdfParse(buffer);
    pdfText = data.text || '';
    numPages = data.numpages || 1;
  } catch (e) {
    pdfParseError = (e as Error).message || 'unknown';
    console.error('[resume-text] pdf-parse failed:', pdfParseError);
    pdfText = '';
  }

  const geminiKey = process.env.GEMINI_API_KEY;
  // 文字型简历（文字层充足）直接用 pdf-parse 结果，跳过 OCR —— 这是绝大多数、且最快的路径。
  // 仅图片型/扫描型（文字层稀疏）才调用 Gemini 视觉识别。
  let ocrError = '';
  if (isTextLayerSparse(pdfText, numPages) && geminiKey) {
    try {
      const ocrText = await extractPdfTextViaGemini(buffer, geminiKey);
      if (meaningfulLength(ocrText) > meaningfulLength(pdfText)) {
        return { text: clipForStorage(ocrText), source: 'gemini-ocr' };
      }
    } catch (e) {
      ocrError = (e as Error).message || 'unknown';
      console.error('[resume-text] gemini ocr failed:', ocrError);
      // OCR 失败 → 回退到 pdf-parse 结果
    }
  }

  if (meaningfulLength(pdfText) > 0) return { text: clipForStorage(pdfText), source: 'pdf-text' };

  if (!geminiKey) {
    return { error: '该 PDF 为图片型（扫描件），暂无法识别。请配置 GEMINI_API_KEY 启用图片识别，或上传 DOCX / 粘贴文本' };
  }
  if (pdfParseError && ocrError) {
    const isCorrupted = pdfParseError.toLowerCase().includes('invalid') || pdfParseError.toLowerCase().includes('password');
    const detail = isCorrupted
      ? 'PDF 已损坏或加密，无法解析，请检查文件或转换为 DOCX 后重试'
      : `pdf-parse: ${pdfParseError.slice(0, 50)}；OCR: ${ocrError.slice(0, 50)}`;
    return { error: detail };
  }
  if (ocrError) {
    return { error: `图片型 PDF，OCR 识别失败（${ocrError.slice(0, 80)}）。请上传 DOCX 或粘贴简历文本` };
  }
  return { error: 'PDF 无可识别文字，请尝试上传 DOCX 格式或复制粘贴简历文本' };
}

/** 从文件 buffer 提取简历正文。支持文档与常见图片格式。 */
export async function extractResumeText(buffer: Buffer, fileName: string): Promise<ExtractResult> {
  const lower = (fileName || '').toLowerCase();
  if (isSupportedVisionImage(lower)) {
    try {
      const text = await extractImageTextViaDeepSeek(buffer, fileName);
      if (meaningfulLength(text) === 0) return { error: '图片中没有识别到简历文字' };
      return { text: clipForStorage(text), source: 'deepseek-vision' };
    } catch (e) {
      return { error: (e as Error).message || '图片简历识别失败，请重试' };
    }
  }
  if (lower.endsWith('.pdf')) return extractPdf(buffer);
  if (lower.endsWith('.docx')) {
    try {
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ buffer });
      return { text: clipForStorage(result.value), source: 'docx' };
    } catch {
      return { error: 'DOCX 解析失败，请尝试复制粘贴简历文本' };
    }
  }
  if (lower.endsWith('.doc')) {
    try {
      const signature = buffer.subarray(0, 16).toString('ascii').trimStart().toLowerCase();
      if (signature.startsWith('<html') || signature.startsWith('<!doctype')) {
        const text = extractWordHtml(buffer);
        if (meaningfulLength(text) > 0) return { text: clipForStorage(text), source: 'word-html' };
      }
      if (buffer.subarray(0, 2).toString('ascii') === 'PK') {
        const mammoth = await import('mammoth');
        const result = await mammoth.extractRawText({ buffer });
        if (meaningfulLength(result.value) > 0) {
          return { text: clipForStorage(result.value), source: 'docx' };
        }
      }
      const WordExtractor = (await import('word-extractor')).default;
      const extractor = new WordExtractor();
      const doc = await extractor.extract(buffer);
      const text = doc.getBody() || '';
      if (meaningfulLength(text) > 0) return { text: clipForStorage(text), source: 'doc' };
      return { error: '.doc 解析为空，请尝试转为 PDF / DOCX 或复制粘贴简历文本' };
    } catch {
      return { error: '该 Word 文件无法解析，请用 Word/WPS 另存为 DOCX 或 PDF 后重试' };
    }
  }
  return { error: '仅支持 PDF / DOC / DOCX / JPG / PNG / WebP / GIF 格式' };
}
