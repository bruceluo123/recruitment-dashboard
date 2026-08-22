import type { Talent } from '@/types/talent';
import { JD_CATEGORY_LABELS, type JDCategory } from '@/types/jd';
import type { ScoreBreakdown } from '@/types/matching';
import type { MatchJDInput, TalentMatchResult } from '@/types/talent-match';
import { buildTalentMatchPrompt, type CandidateBrief } from './talent-match-prompt';
import { aiHttpError } from './ai-fetch';

const MAX_AI_CANDIDATES = 24;
const TEXT_FETCH_CONCURRENCY = 5;
const MAX_RESUME_CHARS = 6000;
const MATCH_MODEL = 'deepseek-v4-flash';

const EN_TOKEN = /[a-zA-Z][a-zA-Z0-9+.#-]{1,}/g;
const SPLIT = /[\s,，;；、。()（）/|:：\n\t+-]+/;

type TermGroup = { label: string; aliases: string[] };

function unique(items: string[]): string[] {
  return Array.from(new Set(items.map((s) => s.trim()).filter(Boolean)));
}

function extractTerms(text: string): Set<string> {
  const terms = new Set<string>();
  const lower = (text || '').toLowerCase();
  lower.match(EN_TOKEN)?.forEach((t) => {
    if (t.length >= 2) terms.add(t);
  });
  for (const seg of (text || '').split(SPLIT)) {
    const zh = seg.replace(/[^\u4e00-\u9fa5]/g, '');
    if (zh.length >= 2) terms.add(zh);
    for (let i = 0; i + 2 <= zh.length; i += 1) terms.add(zh.slice(i, i + 2));
  }
  return terms;
}

function buildTermGroups(query: string): TermGroup[] {
  const lower = query.toLowerCase();
  const groups: TermGroup[] = [];

  if (/(^|[^a-z0-9])ai([^a-z0-9]|$)|aigc|llm|agent|openai|claude|gpt|大模型|人工智能|智能体|生成式|机器学习|深度学习|prompt|提示词/.test(lower)) {
    groups.push({
      label: 'AI',
      aliases: ['ai', 'aigc', 'llm', 'agent', 'openai', 'claude', 'gpt', '大模型', '人工智能', '智能体', '生成式', '机器学习', '深度学习', 'prompt', '提示词', '模型'],
    });
  }
  if (/(^|[^a-z0-9])go([^a-z0-9]|$)|golang|go语言/.test(lower)) {
    groups.push({ label: 'Go', aliases: ['go', 'golang', 'go语言'] });
  }
  if (/架构|architect|architecture/.test(lower)) {
    groups.push({ label: '架构', aliases: ['架构', 'architect', 'architecture', '系统设计', '技术方案'] });
  }
  if (/后端|backend|server/.test(lower)) {
    groups.push({ label: '后端', aliases: ['后端', 'backend', 'server', '服务端'] });
  }

  const knownAliases = new Set(groups.flatMap((g) => g.aliases));
  lower.match(EN_TOKEN)?.forEach((token) => {
    if (token.length >= 2 && !knownAliases.has(token)) groups.push({ label: token, aliases: [token] });
  });
  for (const seg of query.split(SPLIT)) {
    const clean = seg.trim();
    if (clean.length >= 2 && !knownAliases.has(clean.toLowerCase()) && !groups.some((g) => g.label === clean)) {
      groups.push({ label: clean, aliases: [clean] });
    }
  }

  return groups.slice(0, 8);
}

function matchAlias(text: string, alias: string): boolean {
  const lower = text.toLowerCase();
  const needle = alias.toLowerCase();
  if (/^[a-z0-9+.#-]+$/.test(needle)) {
    return new RegExp(`(^|[^a-z0-9+.#-])${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9+.#-]|$)`, 'i').test(lower);
  }
  return lower.includes(needle);
}

function matchGroup(text: string, group: TermGroup): boolean {
  return group.aliases.some((alias) => matchAlias(text, alias));
}

function structuredText(t: Talent): string {
  const categoryLabels = (t.categories || []).map((cat) => JD_CATEGORY_LABELS[cat]).filter(Boolean);
  return [
    t.name, t.jobTitle, t.notes, t.company, t.department, t.techDirection,
    t.level, t.eduLevel, t.school, t.major, t.location, t.workIntent,
    t.monthlySalary, t.annualSalary, t.organization, t.approvalNo,
    ...(t.prevCompanies || []),
    ...categoryLabels,
  ].filter(Boolean).join(' ');
}

function scoreTalentByGroups(t: Talent, groups: TermGroup[], resumeText = ''): number {
  const fieldText = structuredText(t);
  const allText = `${fieldText} ${resumeText}`;
  let score = t.hasResumeText ? 1 : 0;
  let matchedGroups = 0;

  for (const group of groups) {
    const inFields = matchGroup(fieldText, group);
    const inResume = resumeText ? matchGroup(resumeText, group) : false;
    if (inFields || inResume) matchedGroups += 1;
    if (inFields) score += 18;
    if (inResume) score += 12;
    if (matchGroup(`${t.jobTitle} ${t.techDirection || ''}`, group)) score += 8;
  }

  if (groups.length > 0 && matchedGroups === groups.length) score += 40;
  if (groups.length > 1 && matchedGroups === 0 && !groups.some((g) => matchGroup(allText, g))) score -= 20;
  return score;
}

function scoreTalentByTerms(t: Talent, terms: Set<string>): number {
  const text = extractTerms(structuredText(t));
  let score = t.hasResumeText ? 0.5 : 0;
  text.forEach((term) => { if (terms.has(term)) score += 1; });
  return score;
}

export function prefilterTalents(jd: MatchJDInput, jdCategories: JDCategory[], talents: Talent[], limit: number): Talent[] {
  let pool = talents.filter((t) => !t.archived);
  if (jdCategories.length && jd.mode !== 'query') {
    const want = new Set(jdCategories);
    const byCat = pool.filter((t) => (t.categories || []).some((c) => want.has(c)));
    if (byCat.length >= 3) pool = byCat;
  }
  if (pool.length <= limit) return pool;

  const query = `${jd.searchIntent || ''} ${jd.title} ${jd.requirements.join(' ')} ${jd.responsibilities.join(' ')}`;
  const groups = jd.coreTerms?.length ? jd.coreTerms.map((term) => ({ label: term, aliases: [term] })) : buildTermGroups(query);
  const terms = extractTerms(query);

  return pool
    .map((t) => ({
      t,
      score: groups.length ? scoreTalentByGroups(t, groups) : scoreTalentByTerms(t, terms),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.t);
}

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
      const t = talents[cursor];
      cursor += 1;
      map.set(t.id, t.hasResumeText ? await fetchTalentText(t.id) : '');
    }
  };
  await Promise.all(Array.from({ length: Math.min(TEXT_FETCH_CONCURRENCY, talents.length) }, () => worker()));
  return map;
}

async function callAI(prompt: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch('/api/match', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MATCH_MODEL, messages: [{ role: 'user', content: prompt }], temperature: 0, max_tokens: 4500 }),
    signal,
  });
  if (!res.ok) throw aiHttpError(res.status, await res.text().catch(() => ''));
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

function buildBriefs(candidates: Talent[], textMap: Map<string, string>): CandidateBrief[] {
  return candidates.map((t, i) => ({
    index: i + 1,
    name: t.name,
    jobTitle: t.jobTitle,
    resumeText: (textMap.get(t.id) || '').slice(0, MAX_RESUME_CHARS),
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
}

async function rankWithAI(jd: MatchJDInput, candidates: Talent[], textMap: Map<string, string>, signal?: AbortSignal): Promise<TalentMatchResult[]> {
  const prompt = buildTalentMatchPrompt(jd, buildBriefs(candidates, textMap));
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

export async function matchJDToTalents(
  jd: MatchJDInput, jdCategories: JDCategory[], talents: Talent[], signal?: AbortSignal,
): Promise<TalentMatchResult[]> {
  const candidates = prefilterTalents(jd, jdCategories, talents, MAX_AI_CANDIDATES);
  if (!candidates.length) return [];
  const textMap = await fetchTexts(candidates);
  return rankWithAI(jd, candidates, textMap, signal);
}

export async function searchTalentsByQuery(query: string, talents: Talent[], signal?: AbortSignal): Promise<TalentMatchResult[]> {
  const pool = talents.filter((t) => !t.archived);
  if (!pool.length) return [];

  const textMap = await fetchTexts(pool);
  const groups = buildTermGroups(query);
  const candidates = pool
    .map((t) => ({ t, score: scoreTalentByGroups(t, groups, textMap.get(t.id) || '') }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_AI_CANDIDATES)
    .map((r) => r.t);

  if (!candidates.length) return [];
  const jd: MatchJDInput = {
    title: query,
    requirements: [query],
    responsibilities: [],
    mode: 'query',
    searchIntent: query,
    coreTerms: unique(groups.map((g) => g.label)),
  };
  return rankWithAI(jd, candidates, textMap, signal);
}
