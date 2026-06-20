import type { Company } from '@/types/company';
import { COMPANY_DIMENSION_TITLES, emptyDimensions } from '@/types/company';
import type { JDCategory } from '@/types/jd';
import { ALL_CATEGORIES, JD_CATEGORY_LABELS } from '@/types/jd';

/** 调研结果：可直接 upsert 进公司库的结构化字段（不含 id/时间戳） */
export type CompanyResearchDraft = Pick<
  Company,
  'name' | 'industry' | 'categories' | 'summary' | 'dims'
>;

const RESEARCH_MODEL = 'deepseek-chat';

// 把 11 维标题编号成 "1. 公司基本盘" 形式，供 prompt 固定口径
const DIMENSION_LINES = COMPANY_DIMENSION_TITLES.map((t, i) => `${i + 1}. ${t}`).join('\n');

// JD 分类英文 key → 中文，供模型按方向打标签（只能用这些 key）
const CATEGORY_HINT = ALL_CATEGORIES.map((c) => `${c}(${JD_CATEGORY_LABELS[c]})`).join('、');

/**
 * 公司研究系统提示词 —— 移植自 zz-hunteragent-company-research skill 的 11 维方法论。
 * 猎头视角、不写投资判断、找不到就写"未找到公开信息"、严禁编造来源 URL。
 */
const RESEARCH_SYSTEM_PROMPT = `你是猎头公司研究助手，按张振的 11 维度方法论整理一家公司的信息。

核心原则：
1. 这是猎头视角，不是投资报告，不要写总判断、不要替会员下结论。
2. 重点是找全有价值的信息，让会员自己判断公司、项目和候选人机会。
3. 找不到就写"未找到公开信息"，绝对不要编造。
4. 短句、结构化、不堆资料。每个维度写要点即可。
5. 信息源（sources）必须是你确信真实存在的原始 URL；只要不确定 URL 是否真实，就把该维度 sources 留空数组 []，宁可没有也不要编造链接。

必须输出严格的 JSON（不要任何解释文字、不要 markdown 代码块包裹），结构如下：
{
  "industry": "行业，如 AI / 医疗健康 / 新能源",
  "categories": ["从下列 key 中选 0-3 个最相关的岗位方向"],
  "summary": "一句话概述这家公司是做什么的（非投资判断）",
  "dims": [
    { "key": 1, "title": "公司基本盘", "body": "要点...", "sources": [{"title":"来源名","url":"https://..."}] }
  ]
}

categories 只能从这些 key 里选（用英文 key，不要用中文）：${CATEGORY_HINT}

dims 必须恰好 11 项，key 从 1 到 11，title 必须严格等于下面这 11 个维度名：
${DIMENSION_LINES}

每个维度的 body 写这家公司在该维度的真实信息要点；信息不足时写"未找到公开信息"。`;

function buildUserPrompt(name: string): string {
  return `请研究这家公司：${name}\n\n按 11 个维度整理，输出 JSON。`;
}

function stripJsonFence(content: string): string {
  return content
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
}

function coerceCategories(raw: unknown): JDCategory[] {
  if (!Array.isArray(raw)) return [];
  const valid = new Set<string>(ALL_CATEGORIES);
  return raw.filter((c): c is JDCategory => typeof c === 'string' && valid.has(c)).slice(0, 3);
}

function coerceSources(raw: unknown): { title: string; url: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
    .map((s) => ({ title: String(s.title || '').trim(), url: String(s.url || '').trim() }))
    .filter((s) => /^https?:\/\//i.test(s.url))
    .slice(0, 5);
}

/** 把模型返回的 dims 规范化为固定 11 维（缺失补空、顺序对齐标题） */
function normalizeDims(raw: unknown): Company['dims'] {
  const base = emptyDimensions();
  if (!Array.isArray(raw)) return base;
  return base.map((skeleton, i) => {
    const found = raw.find(
      (d) => d && typeof d === 'object' && Number((d as Record<string, unknown>).key) === i + 1,
    ) as Record<string, unknown> | undefined;
    const body = found ? String(found.body || '').trim() : '';
    return {
      key: i + 1,
      title: skeleton.title,
      body: body || '未找到公开信息',
      sources: coerceSources(found?.sources),
    };
  });
}

/**
 * 调研一家公司：调用 DeepSeek 按 11 维方法论生成结构化研究草稿。
 * 注意：DeepSeek 无联网能力，结果来自模型知识，来源 URL 可能不全（已要求宁缺毋造）。
 */
export async function researchCompany(name: string, signal?: AbortSignal): Promise<CompanyResearchDraft> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('请输入公司名');

  const response = await fetch('/api/match', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: RESEARCH_MODEL,
      messages: [
        { role: 'system', content: RESEARCH_SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(trimmed) },
      ],
      temperature: 0.2,
      max_tokens: 4000,
    }),
    signal,
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
    throw new Error(err.error || `调研失败 ${response.status}`);
  }

  const data = await response.json();
  if (data.error) throw new Error(data.error);
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('调研返回为空，请重试');

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stripJsonFence(content));
  } catch {
    throw new Error('调研结果解析失败，请重试');
  }

  return {
    name: trimmed,
    industry: parsed.industry ? String(parsed.industry).trim() : undefined,
    categories: coerceCategories(parsed.categories),
    summary: parsed.summary ? String(parsed.summary).trim() : undefined,
    dims: normalizeDims(parsed.dims),
  };
}
