import type { Talent } from '@/types/talent';
import type { JDCategory } from '@/types/jd';
import type { ScoreBreakdown } from '@/types/matching';
import type { MatchJDInput, TalentMatchResult } from '@/types/talent-match';
import { buildTalentMatchPrompt, type CandidateBrief } from './talent-match-prompt';
import { aiHttpError } from './ai-fetch';

const MAX_AI_CANDIDATES = 15;  // 单次 AI 调用最多精排的候选人数
const TEXT_FETCH_CONCURRENCY = 5;
// 单份简历正文进 prompt 的字数上限：15 份 × 6000 字远低于 4.5MB 请求体上限，防 413；
// 匹配判断用前 6000 字已足够（技能/经历都在前部）。
const MAX_RESUME_CHARS = 6000;
const MATCH_MODEL = 'deepseek-chat';

// ─── 本地预筛 ───

const EN_TOKEN = /[a-zA-Z][a-zA-Z0-9+.#]{1,}/g;
const SPLIT = /[\s,，;；、。()（）/|:：\-—·•\n\t]+/;

function extractTerms(text: string): Set<string> {
  const terms = new Set<string>();
  const lower = (text || '').toLowerCase();
  const en = lower.match(EN_TOKEN);
  if (en) for (const t of en) if (t.length >= 2) terms.add(t);
  for (const seg of (text || '').split(SPLIT)) {
    const zh = seg.replace(/[^\u4e00-\u9fa5]/g, '');
    for (let i = 0; i + 2 <= zh.length; i++) terms.add(zh.slice(i, i + 2));
  }
  return terms;
}

/**
 * 预筛候选人：先按分类与 JD 求交集，再用 JD 关键词对岗位名称粗排，返回 Top limit。
 * 分类交集为空（如粘贴 JD 无分类）时跳过分类过滤，直接全量粗排。
 */
export function prefilterTalents(jd: MatchJDInput, jdCategories: JDCategory[], talents: Talent[], limit: number): Talent[] {
  let pool = talents;
  if (jdCategories.length) {
    const want = new Set(jdCategories);
    const byCat = talents.filter((t) => (t.categories || []).some((c) => want.has(c)));
    if (byCat.length >= 3) pool = byCat;  // 交集太少则回退全量，避免漏掉好候选人
  }
  if (pool.length <= limit) return pool;

  const jdTerms = extractTerms(`${jd.title} ${jd.requirements.join(' ')} ${jd.responsibilities.join(' ')}`);
  const ranked = pool
    .map((t) => {
      const titleTerms = extractTerms(t.jobTitle);
      let s = 0;
      titleTerms.forEach((term) => { if (jdTerms.has(term)) s += 1; });
      // 已扫描出简历正文的候选人略微优先（信息更全，AI 判断更准）
      if (t.hasResumeText) s += 0.5;
      return { t, s };
    })
    .sort((a, b) => b.s - a.s);
  return ranked.slice(0, limit).map((r) => r.t);
}

// ─── 取简历正文 ───

async function fetchTalentText(id: string): Promise<string> {
  try {
    const res = await fetch(`/api/talent/text?id=${encodeURIComponent(id)}`);
    if (!res.ok) return '';
    const data = await res.json();
    return typeof data.text === 'string' ? data.text : '';
  } catch {
    return '';
  }
}

async function fetchTexts(talents: Talent[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let cursor = 0;
  const worker = async () => {
    while (cursor < talents.length) {
      const t = talents[cursor++];
      if (t.hasResumeText) map.set(t.id, await fetchTalentText(t.id));
      else map.set(t.id, '');
    }
  };
  await Promise.all(Array.from({ length: Math.min(TEXT_FETCH_CONCURRENCY, talents.length) }, () => worker()));
  return map;
}

// ─── AI 调用与解析 ───

async function callAI(prompt: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch('/api/match', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MATCH_MODEL, messages: [{ role: 'user', content: prompt }], temperature: 0, max_tokens: 4500 }),
    signal,
  });
  if (!res.ok) {
    throw aiHttpError(res.status, await res.text().catch(() => ''));
  }
  const data = await res.json().catch(() => ({} as { error?: string; choices?: Array<{ message?: { content?: string } }> }));
  if (data.error) throw new Error(data.error);
  if (!data?.choices?.[0]?.message?.content) throw new Error('API 返回数据异常');
  return data.choices[0].message.content;
}

function clampNum(v: unknown): number {
  return Math.min(100, Math.max(0, Number(v) || 0));
}

function buildBreakdown(b: Record<string, unknown> | undefined): ScoreBreakdown {
  return {
    skillsMatch: clampNum(b?.skillsMatch),
    experienceMatch: clampNum(b?.experienceMatch),
    domainMatch: clampNum(b?.domainMatch),
    seniorityMatch: clampNum(b?.seniorityMatch),
    overallFit: clampNum(b?.overallFit),
  };
}

function buildResult(talent: Talent, parsed: Record<string, unknown>): TalentMatchResult {
  return {
    id: `${talent.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    talentId: talent.id,
    talent,
    score: clampNum(parsed.score),
    breakdown: buildBreakdown(parsed.breakdown as Record<string, unknown> | undefined),
    reasoning: String(parsed.reasoning || ''),
    highlights: Array.isArray(parsed.highlights) ? parsed.highlights.map(String) : [],
    concerns: Array.isArray(parsed.concerns) ? parsed.concerns.map(String) : [],
    matchedAt: new Date().toISOString(),
  };
}

/**
 * 用一个 JD 匹配人才库候选人：本地预筛 → 取 Top 候选人简历正文 → 单次 AI 评分 → 降序返回。
 */
export async function matchJDToTalents(
  jd: MatchJDInput, jdCategories: JDCategory[], talents: Talent[], signal?: AbortSignal,
): Promise<TalentMatchResult[]> {
  const candidates = prefilterTalents(jd, jdCategories, talents, MAX_AI_CANDIDATES);
  if (!candidates.length) return [];

  const textMap = await fetchTexts(candidates);
  const briefs: CandidateBrief[] = candidates.map((t, i) => ({
    index: i + 1,
    name: t.name,
    jobTitle: t.jobTitle,
    resumeText: (textMap.get(t.id) || '').slice(0, MAX_RESUME_CHARS),
    // 结构化字段：无简历正文时作为主要匹配依据
    company: t.company,
    prevCompanies: t.prevCompanies,
    techDirection: t.techDirection,
    level: t.level,
    eduLevel: t.eduLevel,
    school: t.school,
    major: t.major,
    location: t.location,
    workIntent: t.workIntent,
    monthlySalary: t.monthlySalary,
  }));

  const prompt = buildTalentMatchPrompt(jd, briefs);
  const content = await callAI(prompt, signal);
  const cleaned = content.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
  const parsed = JSON.parse(cleaned) as { results?: Array<Record<string, unknown>> };
  if (!parsed.results || !Array.isArray(parsed.results)) throw new Error('AI 返回格式异常');

  return parsed.results
    .map((r) => {
      const idx = Number(r.candIndex) - 1;
      return candidates[idx] ? buildResult(candidates[idx], r) : null;
    })
    .filter((r): r is TalentMatchResult => r !== null)
    .sort((a, b) => b.score - a.score);
}
