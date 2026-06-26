// 用 Gemini 视觉模型从 PDF 中提取全文（含图片型/扫描型页面）。
// 使用 Gemini Files API 上传后引用 URI，避免 inline_data 大小限制导致的 503。
// 需要环境变量 GEMINI_API_KEY（Google AI Studio 免费申请）。

const GEMINI_MODEL = 'gemini-2.5-flash';
const GEMINI_FALLBACK_MODEL = 'gemini-1.5-flash';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com';

// 用于匹配的「大概」提取：只要关键信息要点，不逐字照抄全文 → 输出更短、生成更快。
const EXTRACT_PROMPT = [
  '你是简历信息提取助手。请快速提取这份简历的关键信息，用简洁要点输出（不要逐字照抄全文）：',
  '姓名、联系方式、求职意向/最近岗位、工作与项目经历要点（公司/角色/核心职责，每条一句话）、核心技能、教育背景。',
  '中英文照原样保留。只输出提取到的要点，不要任何解释或标题。',
].join('');

const OCR_MAX_OUTPUT_TOKENS = 2048;

interface GeminiPart { text?: string; }
interface GeminiCandidate { content?: { parts?: GeminiPart[] }; }
interface GeminiResponse {
  candidates?: GeminiCandidate[];
  error?: { message?: string };
}
interface FileUploadResponse {
  file?: { uri?: string; name?: string };
  error?: { message?: string };
}

/** 把 PDF 上传到 Gemini Files API，返回 { uri, name }。 */
async function uploadToFilesApi(
  buffer: Buffer,
  apiKey: string,
): Promise<{ uri: string; name: string }> {
  const BOUNDARY = `resumeboundary${Date.now()}`;
  const metaPart = JSON.stringify({ file: { display_name: 'resume.pdf' } });

  // 手动拼接 multipart/related 请求体
  const encoder = new TextEncoder();
  const metaHeader = `--${BOUNDARY}\r\nContent-Type: application/json; charset=utf-8\r\n\r\n`;
  const fileHeader = `\r\n--${BOUNDARY}\r\nContent-Type: application/pdf\r\n\r\n`;
  const footer = `\r\n--${BOUNDARY}--`;

  const body = Buffer.concat([
    Buffer.from(metaHeader),
    encoder.encode(metaPart),
    Buffer.from(fileHeader),
    buffer,
    Buffer.from(footer),
  ]);

  const res = await fetch(
    `${GEMINI_BASE}/upload/v1beta/files?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/related; boundary=${BOUNDARY}`,
        'X-Goog-Upload-Protocol': 'multipart',
      },
      body,
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Gemini Files upload ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as FileUploadResponse;
  if (data.error?.message) throw new Error(`Gemini Files upload: ${data.error.message}`);
  if (!data.file?.uri) throw new Error('Gemini Files upload: 未返回 file URI');

  return { uri: data.file.uri, name: data.file.name ?? '' };
}

/** 上传完成后删除文件（best-effort，失败不影响主流程）。 */
async function deleteFile(fileName: string, apiKey: string): Promise<void> {
  if (!fileName) return;
  await fetch(`${GEMINI_BASE}/v1beta/${fileName}?key=${apiKey}`, { method: 'DELETE' }).catch(() => {});
}

/** 轮询文件状态直到 ACTIVE（最多等 60s）。大 PDF 上传后需要处理时间。 */
async function waitForFileActive(fileName: string, apiKey: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const res = await fetch(`${GEMINI_BASE}/v1beta/${fileName}?key=${apiKey}`);
    if (!res.ok) return; // 查询失败则直接尝试，不阻塞主流程
    const data = (await res.json()) as { state?: string };
    if (data.state === 'ACTIVE') return;
    if (data.state === 'FAILED') throw new Error('Gemini Files 处理失败');
    await new Promise((r) => setTimeout(r, 2000));
  }
}

/** 调用指定模型的 generateContent，返回提取文本。 */
async function callGenerateContent(uri: string, apiKey: string, model: string): Promise<string> {
  const res = await fetch(
    `${GEMINI_BASE}/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { file_data: { mime_type: 'application/pdf', file_uri: uri } },
              { text: EXTRACT_PROMPT },
            ],
          },
        ],
        generationConfig: { temperature: 0, maxOutputTokens: OCR_MAX_OUTPUT_TOKENS },
      }),
    },
  );
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Gemini OCR ${res.status}: ${errText.slice(0, 200)}`);
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

/**
 * 调用 generateContent，遇到限流（429/503）自动重试，
 * 主模型（2.5-flash）失败后降级到备用模型（1.5-flash）。
 */
async function generateContentWithRetry(uri: string, apiKey: string): Promise<string> {
  const tryModel = async (model: string): Promise<string> => {
    let lastErr: Error = new Error('Gemini OCR 失败');
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        return await callGenerateContent(uri, apiKey, model);
      } catch (e) {
        lastErr = e as Error;
        const msg = lastErr.message;
        const isTransient = msg.includes('429') || msg.includes('503') || msg.includes('quota');
        if (isTransient && attempt < 3) {
          await new Promise((r) => setTimeout(r, attempt * 4000));
          continue;
        }
        if (!isTransient) throw lastErr; // 非限流错误不重试
      }
    }
    throw lastErr;
  };

  try {
    return await tryModel(GEMINI_MODEL);
  } catch {
    // 主模型失败后尝试备用模型
    return tryModel(GEMINI_FALLBACK_MODEL);
  }
}

/**
 * 把 PDF 原始字节交给 Gemini Files API，返回识别出的全文。
 * 失败时抛出带可读信息的 Error，由调用方决定回退策略。
 */
export async function extractPdfTextViaGemini(buffer: Buffer, apiKey: string): Promise<string> {
  // 1. 上传文件
  const { uri, name } = await uploadToFilesApi(buffer, apiKey);

  // 2. 等待文件处理完成（大 PDF 上传后需要几秒才能 ACTIVE）
  if (name) await waitForFileActive(name, apiKey);

  // 3. 调用 generateContent（含自动重试和备用模型降级）
  try {
    return await generateContentWithRetry(uri, apiKey);
  } finally {
    // 4. 无论成功失败都删除上传的临时文件
    await deleteFile(name, apiKey);
  }
}
