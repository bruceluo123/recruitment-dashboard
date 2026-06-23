/**
 * 从简历文本中 AI 提取结构化字段，用于增强无简历时的逆向匹配质量。
 * 扫描识别完成后调用，结果写回人才档案。
 */

import type { Talent } from '@/types/talent';

/** AI 能提取的结构化字段子集 */
export interface ExtractedTalentFields {
  company?: string;          // 最近/当前公司
  prevCompanies?: string[];  // 历史公司（最多3家）
  techDirection?: string;    // 技术方向/专长（自由文本，如"推荐算法""增长产品"）
  level?: string;            // 职级/段位（如 P7、L6、高级、总监）
  eduLevel?: string;         // 学历（如 本科/硕士/博士）
  school?: string;           // 毕业院校
  major?: string;            // 专业
  gradYear?: string;         // 最高学历毕业年份（如 2021）
  location?: string;         // 所在地（如 上海/北京/远程）
  workIntent?: string;       // 求职意向（简短，如"看 AI 产品方向"）
  monthlySalary?: string;    // 月薪期望（如 25K-35K）
}

function buildExtractionPrompt(name: string, jobTitle: string, resumeText: string): string {
  return `你是资深猎头，从以下简历中提取关键结构化信息，用于人才匹配。
简历主人：${name}（当前岗位：${jobTitle || '未知'}）

简历内容：
${resumeText.slice(0, 2000)}

请提取以下字段（不确定时返回空字符串或空数组，不要猜测）：
- company: 最近一家公司名称
- prevCompanies: 历史公司数组，最多3家，不含最近一家
- techDirection: 核心技术方向或专长，15字以内
- level: 职级/段位（如P7/L6/高级工程师/总监），不确定留空
- eduLevel: 最高学历（本科/硕士/博士之一）
- school: 毕业院校（最高学历）
- major: 专业
- gradYear: 最高学历毕业年份（4位数字）
- location: 当前所在城市
- workIntent: 求职意向，20字以内
- monthlySalary: 月薪期望（如 25K-35K），无明确信息留空

只返回 JSON，不要 markdown 代码块：
{"company":"","prevCompanies":[],"techDirection":"","level":"","eduLevel":"","school":"","major":"","gradYear":"","location":"","workIntent":"","monthlySalary":""}`;
}

/** 对单个人才提取结构化字段，失败返回 null */
async function extractOne(
  talent: Talent,
  resumeText: string,
  signal?: AbortSignal,
): Promise<ExtractedTalentFields | null> {
  const prompt = buildExtractionPrompt(talent.name, talent.jobTitle, resumeText);
  try {
    const res = await fetch('/api/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        max_tokens: 400,
      }),
      signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    const content: string = data?.choices?.[0]?.message?.content || '';
    const cleaned = content.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    return {
      company: str(parsed.company),
      prevCompanies: arr(parsed.prevCompanies),
      techDirection: str(parsed.techDirection),
      level: str(parsed.level),
      eduLevel: str(parsed.eduLevel),
      school: str(parsed.school),
      major: str(parsed.major),
      gradYear: str(parsed.gradYear),
      location: str(parsed.location),
      workIntent: str(parsed.workIntent),
      monthlySalary: str(parsed.monthlySalary),
    };
  } catch {
    return null;
  }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function arr(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim());
}

/** 取单个人才的简历文本 */
async function fetchText(id: string): Promise<string> {
  try {
    const res = await fetch(`/api/talent/text?id=${encodeURIComponent(id)}`);
    if (!res.ok) return '';
    const data = await res.json();
    return typeof data.text === 'string' ? data.text : '';
  } catch {
    return '';
  }
}

/**
 * 批量提取结构化字段，并发 3，返回 talentId → 提取结果的 Map。
 * 已有 company/techDirection 的人才跳过（避免覆盖手动填写的数据）。
 */
export async function extractTalentFieldsBatch(
  talents: Talent[],
  signal?: AbortSignal,
  onProgress?: (done: number, total: number) => void,
): Promise<Map<string, ExtractedTalentFields>> {
  const result = new Map<string, ExtractedTalentFields>();
  // 只提取"有文本 & 还没填 company/techDirection"的
  const pending = talents.filter((t) => t.hasResumeText && !t.company && !t.techDirection);
  if (!pending.length) return result;

  const CONCURRENCY = 3;
  let cursor = 0;
  let done = 0;

  const worker = async () => {
    while (!signal?.aborted) {
      const idx = cursor++;
      if (idx >= pending.length) return;
      const t = pending[idx];
      const text = await fetchText(t.id);
      if (text && !signal?.aborted) {
        const fields = await extractOne(t, text, signal);
        if (fields) result.set(t.id, fields);
      }
      done++;
      onProgress?.(done, pending.length);
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, () => worker()));
  return result;
}
