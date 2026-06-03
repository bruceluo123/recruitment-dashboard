// AI-based talent info extractor — only extracts 姓名 + 最近一份岗位 title

import type { JDCategory } from '@/types/jd';
import { JD_CATEGORY_LABELS, ALL_CATEGORIES } from '@/types/jd';
import { detectCategories } from '@/lib/jd-parse-core';

export interface ExtractedTalent {
  name: string;
  jobTitle: string;
}

function cleanJson(content: string): string {
  return content.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
}

// ─── AI 岗位分类（参照 JD 库 28 个分类，支持多分类） ───

const VALID_CATEGORIES = new Set<string>(ALL_CATEGORIES);

/** 校验 AI 返回的分类数组；非法或为空时回退到关键词分类。 */
function sanitizeCategories(raw: unknown, fallbackTitle: string): JDCategory[] {
  if (Array.isArray(raw)) {
    const cats = raw
      .map((c) => String(c).trim().toLowerCase())
      .filter((c): c is JDCategory => VALID_CATEGORIES.has(c));
    const unique = Array.from(new Set(cats)).slice(0, 3);
    if (unique.length) return unique;
  }
  const fallback = detectCategories(fallbackTitle);
  return fallback.length ? fallback : ['operations'];
}

const CLASSIFY_TIMEOUT = 45000; // 单批分类超时兜底，超时回退关键词分类

/** 用 AI 把一批岗位名称分类到 JD 库的分类体系（每个岗位 1-3 个分类）。 */
export async function classifyTitleCategories(titles: string[], signal?: AbortSignal): Promise<JDCategory[][]> {
  const list = titles.map((t) => (t || '').trim());
  if (list.length === 0) return [];

  const catLegend = ALL_CATEGORIES.map((c) => `${c}(${JD_CATEGORY_LABELS[c]})`).join('、');
  try {
    const prompt = `你是招聘岗位分类专家。请为下面每个岗位名称分配 1-3 个最匹配的分类。

## 可选分类（只能从中选择，输出英文 id）
${catLegend}

## 岗位名称列表
${list.map((t, i) => `${i + 1}. ${t || '(空)'}`).join('\n')}

## 规则
- 每个岗位返回 1-3 个最相关分类的英文 id 数组，如 ["ai","backend"]
- 含"总监/负责人/组长/VP/CTO"等管理头衔时可附加 director
- 只能使用上面列出的 id，不要编造新分类
- 岗位为空或无法判断时返回 []

## 输出严格JSON数组（顺序与列表一致，不要markdown代码块）：
[["id1","id2"], ["id1"], ...]`;

    const timer = new AbortController();
    const timeout = setTimeout(() => timer.abort(), CLASSIFY_TIMEOUT);
    const onStop = () => timer.abort();
    signal?.addEventListener('abort', onStop);
    try {
      const res = await fetch('/api/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: prompt }], temperature: 0.1, max_tokens: 1500 }),
        signal: timer.signal,
      });
      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content;
      if (!content) return list.map((t) => sanitizeCategories(null, t));
      const parsed = JSON.parse(cleanJson(content));
      if (!Array.isArray(parsed)) return list.map((t) => sanitizeCategories(null, t));
      return list.map((t, i) => sanitizeCategories(parsed[i], t));
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onStop);
    }
  } catch {
    return list.map((t) => sanitizeCategories(null, t));
  }
}

/** Heuristic fallback: pick a likely name from the first lines if AI fails. */
function fallbackName(text: string): string {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  for (const line of lines.slice(0, 8)) {
    // Chinese name: 2-4 Chinese chars on its own short line
    const zh = line.match(/^[\u4e00-\u9fa5]{2,4}$/);
    if (zh) return zh[0];
    // "姓名：xxx" style
    const labeled = line.match(/(?:姓\s*名|name)[:：]\s*([^\s,，|]+)/i);
    if (labeled) return labeled[1].trim();
    // English name: 2-3 capitalized words on a short line
    const en = line.match(/^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2}$/);
    if (en) return en[0];
  }
  return '';
}

export async function extractTalentInfo(rawText: string): Promise<ExtractedTalent | null> {
  const text = rawText.slice(0, 3000);
  try {
    const prompt = `从以下简历文本中提取候选人信息。只需提取两个字段。

## 简历文本
${text}

## 要求
- name: 候选人姓名（中文或英文，只要姓名本身）
- jobTitle: 候选人最近一份工作的岗位名称（最新/当前职位的 title）

## 输出严格JSON（不要markdown代码块）：
{"name": "姓名", "jobTitle": "最近岗位title"}`;

    const res = await fetch('/api/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: prompt }], temperature: 0.1, max_tokens: 200 }),
    });
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return { name: fallbackName(text), jobTitle: '' };
    const parsed = JSON.parse(cleanJson(content));
    return {
      name: String(parsed.name || '').trim() || fallbackName(text),
      jobTitle: String(parsed.jobTitle || '').trim(),
    };
  } catch {
    return { name: fallbackName(text), jobTitle: '' };
  }
}

/** Batch extract multiple resumes in a single API call to reduce round-trips. */
export async function extractMultipleTalents(texts: string[]): Promise<(ExtractedTalent | null)[]> {
  if (texts.length === 0) return [];
  if (texts.length === 1) return [await extractTalentInfo(texts[0])];

  try {
    const prompt = `从以下${texts.length}份简历分别提取候选人信息。每份只需提取姓名和最近一份工作的岗位title。

${texts.map((t, i) => `### 简历${i + 1}\n${t.slice(0, 1800)}`).join('\n\n')}

## 输出严格JSON数组（顺序与简历一致，不要markdown代码块）：
[{"name": "姓名", "jobTitle": "最近岗位title"}, ...]`;

    const res = await fetch('/api/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: prompt }], temperature: 0.1, max_tokens: 1500 }),
    });
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return texts.map((t) => ({ name: fallbackName(t), jobTitle: '' }));
    const parsed = JSON.parse(cleanJson(content));
    if (!Array.isArray(parsed)) return texts.map((t) => ({ name: fallbackName(t), jobTitle: '' }));
    return texts.map((t, i) => {
      const p = parsed[i];
      if (!p) return { name: fallbackName(t), jobTitle: '' };
      return {
        name: String(p.name || '').trim() || fallbackName(t),
        jobTitle: String(p.jobTitle || '').trim(),
      };
    });
  } catch {
    return texts.map((t) => ({ name: fallbackName(t), jobTitle: '' }));
  }
}
