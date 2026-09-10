import type { JD } from '@/types/jd';
import type { CandidateAssessment, MatchingResult } from '@/types/matching';
import { buildBatchMatchingPrompt, buildCandidateAssessmentPrompt } from './matching-prompt';
import { aiHttpError } from './ai-fetch';

// 一轮最多16个完整JD，4个请求并行；结束时一次发布结果，没有后台追加评分。
const MAX_AI_CANDIDATES = 16;
const MATCH_MODEL = 'deepseek-v4-flash';
const MATCH_CACHE_VERSION = 'resume-semantic-v2';
const MATCH_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MATCH_CACHE_PREFIX = 'recruit:stable-match:';
const memoryCache = new Map<string, { expiresAt: number; value: unknown }>();

export function hasOpenGap(jd: JD): boolean {
  const n = parseInt(String(jd.gap ?? '').trim(), 10);
  return !Number.isFinite(n) || n > 0;
}

async function cacheKey(kind: string, resumeText: string, jds: JD[]): Promise<string> {
  const input = JSON.stringify({ resumeText, jds: jds.map((jd) => ({
    id: jd.id, title: jd.title, categories: jd.categories, department: jd.department,
    organization: jd.organization, serviceUnit: jd.serviceUnit, location: jd.location,
    salaryRange: jd.salaryRange, salaryText: jd.salaryText, responsibilities: jd.responsibilities,
    requirements: jd.requirements, preferredQualifications: jd.preferredQualifications, notes: jd.notes,
  })) });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return MATCH_CACHE_PREFIX + MATCH_CACHE_VERSION + ':' + kind + ':' +
    Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

function readCache<T>(key: string): T | null {
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(key) : null;
    const entry = memoryCache.get(key) || (raw ? JSON.parse(raw) : null);
    if (!entry || entry.expiresAt <= Date.now()) return null;
    return entry.value as T;
  } catch { return null; }
}

function writeCache(key: string, value: unknown): void {
  const entry = { expiresAt: Date.now() + MATCH_CACHE_TTL_MS, value };
  if (memoryCache.size >= 96) memoryCache.delete(memoryCache.keys().next().value!);
  memoryCache.set(key, entry);
  if (typeof window === 'undefined') return;
  try {
    const keys = Object.keys(window.localStorage).filter((item) => item.startsWith(MATCH_CACHE_PREFIX));
    while (keys.length >= 96) window.localStorage.removeItem(keys.shift()!);
    window.localStorage.setItem(key, JSON.stringify(entry));
  } catch { /* 缓存不可用不影响本次分析。 */ }
}

async function callAI(prompt: string, signal: AbortSignal, maxTokens: number): Promise<Record<string, unknown>> {
  if (prompt.length > 280000) throw new Error('本次资料过多，请缩小岗位范围后分析');
  const response = await fetch('/api/match', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MATCH_MODEL, messages: [{ role: 'user', content: prompt }], temperature: 0, max_tokens: maxTokens }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(50_000)]),
  });
  if (!response.ok) throw new Error(aiHttpError(response.status, await response.text().catch(() => '')).message);
  const data = await response.json();
  const choice = data?.choices?.[0];
  if (choice?.finish_reason === 'length') throw new Error('分析返回不完整，请重试本轮未完成的岗位');
  const content = choice?.message?.content;
  if (typeof content !== 'string') throw new Error('分析服务未返回有效结果');
  try {
    const parsed = JSON.parse(content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim());
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch { throw new Error('分析返回格式不完整，请重试'); }
}

function normalize(text: string): string {
  return text.normalize('NFKC').replace(/[\s\u00ad\u200b-\u200d\ufeff\ufffd\u2022\uf0b7]/g, '').toLowerCase();
}
function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).slice(0, 4) : [];
}
function quoteExists(text: string, quote: unknown, minimumLength = 6): quote is string {
  return typeof quote === 'string' && normalize(quote).length >= minimumLength && normalize(text).includes(normalize(quote));
}
function factualText(text: string): string {
  return text.replace(/^\s*(?:求职意向|应聘岗位|目标岗位|期望岗位)[：:].*$/gim, '');
}
function positiveQuote(text: string, quote: unknown): quote is string {
  if (!quoteExists(text, quote)) return false;
  const negative = /没有|从未|未做|未曾|不具备|不熟悉|缺乏|无.{0,12}经验|\b(?:no|never|without)\b/i;
  // PDF 的自动换行不代表句末；保留整句核对，不能切掉引用前的否定词。
  return text.split(/[。；;]+/).some((sentence) => normalize(sentence).includes(normalize(quote)) && !negative.test(sentence));
}

function parseProfile(parsed: Record<string, unknown>, text: string): CandidateAssessment | null {
  const facts = (Array.isArray(parsed.facts) ? parsed.facts : []).filter((item) =>
    item && typeof item === 'object' && positiveQuote(text, item.quote) && typeof item.meaning === 'string',
  ).slice(0, 5).map((item) => ({ quote: String(item.quote), meaning: String(item.meaning) }));
  const levels = (Array.isArray(parsed.levels) ? parsed.levels : []).filter((item) =>
    item && typeof item === 'object' && positiveQuote(text, item.quote) && typeof item.label === 'string',
  ).slice(0, 3).map((item) => ({ label: String(item.label), quote: String(item.quote) }));
  // 概述与逐字引用分开校验：PDF 换行/OCR 字符差异可能让引用无法逐字命中，
  // 但不应因此丢掉已经生成的主方向与人选概述。
  if (typeof parsed.primaryRole !== 'string' || !parsed.primaryRole.trim()
    || typeof parsed.summary !== 'string' || !parsed.summary.trim()) {
    return null;
  }
  return { primaryRole: parsed.primaryRole, summary: parsed.summary, levels, facts };
}

function buildResult(jd: JD, resumeId: string, parsed: Record<string, unknown>, text: string, profile: CandidateAssessment): MatchingResult {
  const source = parsed.breakdown as Record<string, unknown> | undefined;
  const fields = ['skillsMatch', 'experienceMatch', 'seniorityMatch', 'domainMatch'] as const;
  if (!source || fields.some((key) => typeof source[key] !== 'number' || !Number.isFinite(source[key]) || Number(source[key]) < 0 || Number(source[key]) > 100)
    || !['direct', 'review', 'reject'].includes(String(parsed.decision))) throw new Error('岗位评分字段不完整');
  const skillsMatch = Number(source.skillsMatch);
  const experienceMatch = Number(source.experienceMatch);
  const seniorityMatch = Number(source.seniorityMatch);
  const domainMatch = Number(source.domainMatch);
  const jdText = [jd.title, ...jd.responsibilities, ...jd.requirements, ...(jd.preferredQualifications || []), jd.notes || ''].join('\n');
  const evidence: NonNullable<MatchingResult['evidence']> = [];
  for (const item of Array.isArray(parsed.evidence) ? parsed.evidence : []) {
    if (!item || !positiveQuote(text, item.quote) || !quoteExists(jdText, item.requirement, 2)) continue;
    if (evidence.some((row) => normalize(row.quote) === normalize(item.quote))) continue;
    evidence.push({ quote: item.quote, requirement: item.requirement, dimension: String(item.dimension || 'professional') });
    if (evidence.length === 3) break;
  }
  const concerns = stringList(parsed.concerns);
  const levelFit: MatchingResult['levelFit'] = ['close', 'candidate_below_job', 'job_below_candidate', 'unknown'].includes(String(parsed.levelFit))
    ? parsed.levelFit as MatchingResult['levelFit'] : 'unknown';
  // 缺证据降低推荐确定性，不把不同程度的候选岗位压成同一个分数。
  let score = Math.round(skillsMatch * 0.3 + experienceMatch * 0.35 + seniorityMatch * 0.25 + domainMatch * 0.1);
  let matchTier = parsed.decision as NonNullable<MatchingResult['matchTier']>;
  const hard = parsed.hardMismatch as { quote?: unknown; requirement?: unknown } | null;
  if (hard && quoteExists(text, hard.quote) && quoteExists(jdText, hard.requirement, 2)) {
    matchTier = 'reject';
    concerns.push('明确条件差异：' + hard.requirement + '；简历：' + hard.quote);
  }
  if (evidence.length < 2) {
    concerns.push('可核对的经历证据不足，推荐前需确认');
    score = Math.max(0, score - (2 - evidence.length) * 8);
  }
  if (matchTier === 'direct' && (score < 80 || evidence.length < 2 || levelFit !== 'close' || parsed.corePending !== false)) matchTier = 'review';
  return {
    id: resumeId + '-' + jd.id, jdId: jd.id, jd, resumeId,
    score, breakdown: { skillsMatch, experienceMatch, seniorityMatch, domainMatch, overallFit: score },
    assessmentSource: 'ai', assessmentStatus: 'completed', matchTier,
    reasoning: String(parsed.reasoning || ''), levelFit, levelReason: String(parsed.levelReason || ''),
    questions: [], evidence, candidateLevels: profile.levels.map((item) => item.label),
    highlights: evidence.map((item) => item.quote + ' → ' + item.requirement),
    concerns: Array.from(new Set(concerns)), matchedAt: new Date().toISOString(),
  };
}

export type OnResult = (result: MatchingResult | MatchingResult[]) => void;
export type MatchProgress = {
  stage: 'profiling' | 'evaluating' | 'completed';
  completed: number;
  total: number;
  profile?: CandidateAssessment;
};

export async function matchResumeToJDs(
  resumeText: string, jds: JD[], resumeId: string, signal?: AbortSignal,
): Promise<MatchingResult[]> {
  let results: MatchingResult[] = [];
  await matchResumeToJDsStream(resumeText, jds, resumeId, (value) => { results = Array.isArray(value) ? value : [value]; }, signal);
  return results;
}

/** 保留调用接口；本轮只有进度更新，结果在完成后一次性交付。 */
export async function matchResumeToJDsStream(
  resumeText: string, jds: JD[], resumeId: string, onResult: OnResult, signal?: AbortSignal,
  onProgress?: (progress: MatchProgress) => void,
): Promise<void> {
  const openJds = jds.filter((jd) => jd.status !== 'paused' && hasOpenGap(jd)).sort((a, b) => a.id.localeCompare(b.id));
  if (!openJds.length) return;
  signal?.throwIfAborted();
  const deadline = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(100_000)]);
  const text = factualText(resumeText);
  onProgress?.({ stage: 'profiling', completed: 0, total: 0 });
  const selectionKey = await cacheKey('selection', text, openJds);
  let selection = readCache<{ profile: CandidateAssessment; ids: string[] }>(selectionKey);
  if (!selection) {
    const profileKey = await cacheKey('profile', text, []);
    const existingProfile = readCache<CandidateAssessment>(profileKey);
    const parsed = existingProfile && openJds.length <= MAX_AI_CANDIDATES
      ? {} : await callAI(buildCandidateAssessmentPrompt(text, openJds, MAX_AI_CANDIDATES, existingProfile || undefined), deadline, 1800);
    let profile = existingProfile || parseProfile(parsed, text);
    if (!profile) {
      // 只补提一次简历概览，不重发岗位目录；失败也不能阻断完整JD的事实对照。
      try {
        deadline.throwIfAborted();
        const repaired = await callAI(buildCandidateAssessmentPrompt(text, [], MAX_AI_CANDIDATES), deadline, 1800);
        profile = parseProfile(repaired, text);
      } catch (error) {
        if (deadline.aborted) throw error;
      }
    }
    const verifiedProfile = Boolean(profile);
    profile ||= {
      primaryRole: '人选概览待确认',
      summary: '概览引用暂未核实，以下岗位将直接根据简历原文判断；职级以各岗位的经历对照为准。',
      levels: [], facts: [],
    };
    if (!existingProfile && verifiedProfile) writeCache(profileKey, profile);
    const indexes = Array.isArray(parsed.shortlist)
      ? Array.from(new Set(parsed.shortlist.filter((value): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= openJds.length)))
      : [];
    const candidates = openJds.length <= MAX_AI_CANDIDATES ? openJds : indexes.slice(0, MAX_AI_CANDIDATES).map((index) => openJds[index - 1]);
    if (!candidates.length) throw new Error('未召回可比较的岗位，请缩小范围或指定岗位分析；其余岗位尚未判定');
    selection = { profile, ids: candidates.map((jd) => jd.id) };
    if (verifiedProfile) writeCache(selectionKey, selection);
  }
  deadline.throwIfAborted();
  const profile = selection.profile;
  const selectedIds = new Set(selection.ids);
  const candidates = openJds.filter((jd) => selectedIds.has(jd.id));
  const results: MatchingResult[] = [];
  const pending: Array<{ jd: JD; key: string }> = [];
  for (const jd of candidates) {
    const key = await cacheKey('result', text, [jd]);
    const cached = readCache<MatchingResult>(key);
    if (cached?.assessmentStatus === 'completed') {
      results.push({ ...cached, jd, resumeId, id: resumeId + '-' + jd.id, candidateLevels: profile.levels.map((item) => item.label), cached: true });
    } else pending.push({ jd, key });
  }
  const progress = () => onProgress?.({ stage: 'evaluating', completed: results.length, total: candidates.length, profile });
  progress();
  let cursor = 0;
  const worker = async () => {
    while (cursor < pending.length) {
      const batch = pending.slice(cursor, cursor + 4);
      cursor += 4;
      let rows: Array<Record<string, unknown>> = [];
      let errorMessage = '岗位分析未完成，请重试';
      try {
        deadline.throwIfAborted();
        const parsed = await callAI(buildBatchMatchingPrompt(text, batch.map((item) => item.jd), profile), deadline, 4800);
        rows = Array.isArray(parsed.results) ? parsed.results.filter((row) => row && typeof row === 'object') : [];
      } catch (error) {
        if (signal?.aborted) throw error;
        errorMessage = error instanceof Error && error.name === 'TimeoutError' ? '本轮分析超时，请重试未完成岗位' : (error as Error).message;
      }
      for (let index = 0; index < batch.length; index++) {
        signal?.throwIfAborted();
        const { jd, key } = batch[index];
        const matches = rows.filter((row) => row.jdIndex === index + 1);
        try {
          if (matches.length !== 1) throw new Error(errorMessage);
          const result = buildResult(jd, resumeId, matches[0], text, profile);
          results.push(result);
          writeCache(key, result);
        } catch (error) {
          results.push({
            id: resumeId + '-' + jd.id, jdId: jd.id, jd, resumeId, score: 0,
            assessmentStatus: 'failed', assessmentSource: 'ai',
            breakdown: { skillsMatch: 0, experienceMatch: 0, seniorityMatch: 0, domainMatch: 0, overallFit: 0 },
            reasoning: (error as Error).message, highlights: [], concerns: [], matchedAt: new Date().toISOString(),
          });
        }
      }
      progress();
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, Math.ceil(pending.length / 4)) }, () => worker()));
  signal?.throwIfAborted();
  onResult(results.sort((a, b) => b.score - a.score || a.jdId.localeCompare(b.jdId)));
  onProgress?.({ stage: 'completed', completed: results.length, total: candidates.length, profile });
}
