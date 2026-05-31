// 用 Gemini 视觉模型从 PDF 中提取全文（含图片型/扫描型页面）。
// DeepSeek 是纯文本模型无视觉能力，图片型简历必须走此路径。
// 需要环境变量 GEMINI_API_KEY（Google AI Studio 免费申请）。

const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const EXTRACT_PROMPT = [
  '你是简历文本提取助手。请把这份 PDF 简历里的所有文字内容完整、按阅读顺序提取出来，',
  '包括姓名、联系方式、个人简介、工作经历、项目经历、技能、教育背景等所有段落。',
  '保留原始语言（中英文混排照原样）。只输出提取到的纯文本，不要添加任何解释、标题或总结。',
].join('');

interface GeminiPart {
  text?: string;
}
interface GeminiCandidate {
  content?: { parts?: GeminiPart[] };
}
interface GeminiResponse {
  candidates?: GeminiCandidate[];
  error?: { message?: string };
}

/**
 * 把 PDF 原始字节交给 Gemini，返回识别出的全文。
 * 失败时抛出带可读信息的 Error，由调用方决定回退策略。
 */
export async function extractPdfTextViaGemini(buffer: Buffer, apiKey: string): Promise<string> {
  const base64 = buffer.toString('base64');

  const res = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { inline_data: { mime_type: 'application/pdf', data: base64 } },
            { text: EXTRACT_PROMPT },
          ],
        },
      ],
      generationConfig: { temperature: 0, maxOutputTokens: 8192 },
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Gemini OCR ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = (await res.json()) as GeminiResponse;
  if (data.error?.message) throw new Error(`Gemini OCR: ${data.error.message}`);

  const text = (data.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p.text ?? '')
    .join('')
    .trim();

  if (!text) throw new Error('Gemini OCR 返回空文本');
  return text;
}
