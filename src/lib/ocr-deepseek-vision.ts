const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';
const VISION_MODEL = 'deepseek-v4-flash-vision-exp';
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_PDF_BYTES = 50 * 1024 * 1024;
const MAX_PDF_PAGES = 20;

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
};

function fileExtension(fileName: string): string {
  return fileName.toLowerCase().split('.').pop() || '';
}

export function isSupportedVisionImage(fileName: string): boolean {
  return Boolean(IMAGE_MIME_BY_EXTENSION[fileExtension(fileName)]);
}

function contentText(content: unknown): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (!part || typeof part !== 'object') return '';
      const value = (part as { text?: unknown }).text;
      return typeof value === 'string' ? value : '';
    })
    .filter(Boolean)
    .join('\n')
    .trim();
}

export async function extractImageTextViaDeepSeek(
  buffer: Buffer,
  fileName: string,
  apiKey = process.env.DEEPSEEK_API_KEY,
): Promise<string> {
  if (!apiKey) throw new Error('未配置 DEEPSEEK_API_KEY，无法识别图片简历');
  if (!isSupportedVisionImage(fileName)) throw new Error('不支持该图片格式');
  if (buffer.length > MAX_IMAGE_BYTES) throw new Error('图片超过 20MB，请压缩后重试');

  const mimeType = IMAGE_MIME_BY_EXTENSION[fileExtension(fileName)];
  const response = await fetch(DEEPSEEK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: VISION_MODEL,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: [
              '请完整提取这张图片中的简历或候选人资料文字。',
              '保留姓名、联系方式、工作经历、公司、岗位、起止时间、职责、项目、技能、教育经历、薪资和到岗信息。',
              '按图片原有层级整理为纯文本，不要总结，不要补写图片中没有的信息。',
              '如果图片不是简历，也请逐项提取其中与岗位、候选人或面试安排有关的全部文字。',
            ].join('\n'),
          },
          {
            type: 'image_url',
            image_url: {
              url: `data:${mimeType};base64,${buffer.toString('base64')}`,
            },
          },
        ],
      }],
      thinking: { type: 'disabled' },
      temperature: 0,
      max_tokens: 4096,
    }),
  });

  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 300);
    throw new Error(`DeepSeek 视觉识别失败（${response.status}）${detail ? `：${detail}` : ''}`);
  }

  const data = await response.json() as {
    choices?: Array<{ message?: { content?: unknown } }>;
    error?: { message?: string } | string;
  };
  const text = contentText(data.choices?.[0]?.message?.content);
  if (!text) {
    const detail = typeof data.error === 'string' ? data.error : data.error?.message;
    throw new Error(detail || 'DeepSeek 视觉识别返回了空内容');
  }
  return text;
}

/** 将图片型 PDF 逐页渲染为 PNG，再复用 DeepSeek 视觉识别。 */
export async function extractPdfTextViaDeepSeek(
  buffer: Buffer,
  apiKey = process.env.DEEPSEEK_API_KEY,
): Promise<string> {
  if (!apiKey) throw new Error('未配置 DEEPSEEK_API_KEY，无法识别图片型 PDF');
  if (buffer.length > MAX_PDF_BYTES) throw new Error('PDF 超过 50MB，请压缩后重试');

  const { pdfToPng, VerbosityLevel } = await import('pdf-to-png-converter');
  const metadata = await pdfToPng(buffer, {
    returnMetadataOnly: true,
    maxInputBytes: MAX_PDF_BYTES,
    verbosityLevel: VerbosityLevel.ERRORS,
  });
  if (!metadata.length) throw new Error('PDF 没有可识别页面');
  if (metadata.length > MAX_PDF_PAGES) {
    throw new Error(`图片型 PDF 超过 ${MAX_PDF_PAGES} 页，请拆分后重试`);
  }

  const pages = await pdfToPng(buffer, {
    viewportScale: 2,
    returnPageContent: true,
    processPagesInParallel: true,
    concurrencyLimit: 1,
    maxInputBytes: MAX_PDF_BYTES,
    verbosityLevel: VerbosityLevel.ERRORS,
  });
  const extracted: string[] = [];
  for (const page of pages) {
    if (!page.content) throw new Error(`PDF 第 ${page.pageNumber} 页转换失败`);
    const text = await extractImageTextViaDeepSeek(
      page.content,
      `resume-page-${page.pageNumber}.png`,
      apiKey,
    );
    extracted.push(`第 ${page.pageNumber} 页\n${text}`);
  }
  return extracted.join('\n\n');
}
