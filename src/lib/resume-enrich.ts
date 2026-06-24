import type { JDCategory } from '@/types/jd';
import { ALL_CATEGORIES } from '@/types/jd';

export interface EnrichFields {
  company?: string;
  prevCompanies?: string[];
  techDirection?: string;
  eduLevel?: string;
  school?: string;
  gradYear?: string;
  categories?: JDCategory[];
}

/** 从文件名提取姓名和岗位。支持「-」「_」「+」「－」以及「两个及以上空格」分隔。 */
export function parseEnrichFileName(fileName: string): { name: string; jobTitle: string } {
  const base = fileName.replace(/\.(pdf|docx?)$/i, '').trim();
  // 多空格优先（"张三  前端"）
  const spaceIdx = base.search(/\s{2,}/);
  if (spaceIdx !== -1) {
    return { name: base.slice(0, spaceIdx).trim(), jobTitle: base.slice(spaceIdx).trim() };
  }
  // 单字符分隔符
  const sep = base.search(/[-+_－]/);
  if (sep === -1) return { name: base, jobTitle: '' };
  return { name: base.slice(0, sep).trim(), jobTitle: base.slice(sep + 1).trim() };
}

/** 在人才库中按姓名找到对应人选（先精确匹配，再包含匹配）。 */
export function findTalentByName(
  talents: Array<{ id: string; name: string }>,
  parsedName: string,
): { id: string; name: string } | undefined {
  const q = parsedName.trim().toLowerCase();
  if (!q) return undefined;
  return (
    talents.find((t) => t.name.trim().toLowerCase() === q) ??
    talents.find(
      (t) =>
        t.name.trim().toLowerCase().includes(q) ||
        q.includes(t.name.trim().toLowerCase()),
    )
  );
}

const CAT_LIST = ALL_CATEGORIES.join(' / ');

/** 调用 DeepSeek 从简历文字中提取结构化档案字段。 */
export async function enrichResumeText(
  text: string,
  signal?: AbortSignal,
): Promise<EnrichFields> {
  const prompt = `你是专业简历解析助手，从以下简历中提取结构化信息，输出纯 JSON，字段不存在填 null 或 []。

简历正文：
${text.slice(0, 5000)}

需要字段：
- company: 最近/当前工作公司名称（字符串）
- prevCompanies: 所有历史公司名称列表，不含当前公司（字符串数组）
- techDirection: 技术方向，1-3个关键词用/分隔（如"后端开发/Go/分布式"）
- eduLevel: 最高学历，只能是"高中"/"大专"/"本科"/"硕士"/"博士"之一
- school: 最高学历院校名称（字符串）
- gradYear: 最高学历毕业年份（4位数字字符串，如"2019"）
- categories: 最匹配的岗位分类，从以下中选1-3个: ${CAT_LIST}

只返回 JSON，不要任何解释或 markdown：`;

  const res = await fetch('/api/match', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      max_tokens: 512,
    }),
    signal,
  });
  if (!res.ok) throw new Error(`AI API ${res.status}`);
  const data = (await res.json()) as Record<string, unknown>;
  if (data.error) throw new Error(String(data.error));

  const raw = String(
    (data?.choices as Array<{ message: { content: string } }>)?.[0]?.message?.content ?? '',
  );
  const cleaned = raw.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
  const parsed = JSON.parse(cleaned) as Record<string, unknown>;

  const str = (v: unknown) =>
    typeof v === 'string' && v.trim() ? v.trim() : undefined;
  const strArr = (v: unknown): string[] =>
    Array.isArray(v)
      ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()).map((x) => x.trim())
      : [];
  const cats = strArr(parsed.categories).filter((c) =>
    (ALL_CATEGORIES as string[]).includes(c),
  ) as JDCategory[];

  return {
    company: str(parsed.company),
    prevCompanies: strArr(parsed.prevCompanies),
    techDirection: str(parsed.techDirection),
    eduLevel: str(parsed.eduLevel),
    school: str(parsed.school),
    gradYear: str(parsed.gradYear),
    categories: cats.length ? cats : undefined,
  };
}
