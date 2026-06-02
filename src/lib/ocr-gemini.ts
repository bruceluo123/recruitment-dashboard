// 用 Gemini 视觉模型从 PDF 中提取全文（含图片型/扫描型页面）。
// DeepSeek 是纯文本模型无视觉能力，图片型简历必须走此路径。
// 需要环境变量 GEMINI_API_KEY（Google AI Studio 免费申请）。

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// 用于匹配的「大概」提取：只要关键信息要点，不逐字照抄全文 → 输出更短、生成更快。
const EXTRACT_PROMPT = [
  '你是简历信息提取助手。请快速提取这份简历的关键信息，用简洁要点输出（不要逐字照抄全文）：',
  '姓名、联系方式、求职意向/最近岗位、工作与项目经历要点（公司/角色/核心职责，每条一句话）、核心技能、教育背景。',
  '中英文照原样保留。只输出提取到的要点，不要任何解释或标题。',
].join('');

// 「大概」即可：输出上限收紧，缩短生成时间（OCR 是扫描的主要耗时来源）
const OCR_MAX_OUTPUT_TOKENS = 2048;

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
      generationConfig: { temperature: 0, maxOutputTokens: OCR_MAX_OUTPUT_TOKENS },
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
