import { hasCategory, type JD } from '@/types/jd';
import type { MatchingResult } from '@/types/matching';
import { buildBatchMatchingPrompt, buildMatchingPrompt } from './matching-prompt';
import { aiHttpError } from './ai-fetch';
import { detectResumeCategories, prefilterJDs } from './jd-prefilter';

// 一次 AI 精排的 JD 数。无论岗位总量多少，都先由本地粗排选出最相关的 24 个交给 AI。
const MAX_AI_CANDIDATES = 24;
// 简历正文进 prompt 的字数上限：匹配证据通常集中在前部，截短能明显降低 AI 等待时间。
const MAX_RESUME_CHARS = 10000;

// 仅匹配仍有缺口的岗位：缺口为 0（或非正数）= 不需要再招，跳过匹配
function hasOpenGap(jd: JD): boolean {
  const n = parseInt(String(jd.gap ?? '').trim(), 10);
  return Number.isFinite(n) && n > 0;
}
// 非推理快速模型：实测 ~24s 完成；推理模型(deepseek-v4-pro)会思考耗光token预算、~84s且空输出
const MATCH_MODEL = 'deepseek-v4-flash';
const MATCH_CACHE_VERSION = 'v1';
const MATCH_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MATCH_CACHE_PREFIX = 'recruit:stable-match:';
const MAX_MATCH_CACHE_ENTRIES = 12;

async function callAI(
  messages: Array<{ role: string; content: string }>,
  signal?: AbortSignal,
  maxTokens = 2000,
): Promise<string> {
  const response = await fetch('/api/match', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MATCH_MODEL, messages, temperature: 0, max_tokens: maxTokens }),
    signal,
  });

  if (!response.ok) {
    throw aiHttpError(response.status, await response.text().catch(() => ''));
  }

  const data = await response.json().catch(() => ({} as { error?: string; choices?: Array<{ message?: { content?: string } }> }));
  if (data.error) throw new Error(data.error);
  if (!data?.choices?.[0]?.message?.content) throw new Error('API 返回数据异常');
  return data.choices[0].message.content;
}

function clampNum(v: unknown): number {
  return Math.min(100, Math.max(0, Number(v) || 0));
}

const VALID_SCORE_CAPS = new Set([50, 55, 59, 69, 100]);

function scoreCap(parsed: Record<string, unknown>): number {
  const value = Number(parsed.scoreCap);
  return VALID_SCORE_CAPS.has(value) ? value : 100;
}

function parseJson(content: string): Record<string, unknown> {
  const cleaned = content.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
  return JSON.parse(cleaned);
}

function buildResult(jd: JD, resumeId: string, parsed: Record<string, unknown>): MatchingResult {
  const cap = scoreCap(parsed);
  const rawScore = clampNum(parsed.score);
  const rawBreakdown = parsed.breakdown as Record<string, unknown>;
  const rawConcerns = Array.isArray(parsed.concerns) ? parsed.concerns.map(String) : [];
  const capReason = String(parsed.capReason || '').trim();
  const concerns = cap < 100 && capReason
    ? [...rawConcerns, `匹配上限：${capReason}`]
    : rawConcerns;
  return {
    id: `${resumeId}-${jd.id}`,
    jdId: jd.id, jd, resumeId,
    score: Math.min(rawScore, cap),
    breakdown: {
      skillsMatch: clampNum(rawBreakdown?.skillsMatch),
      experienceMatch: clampNum(rawBreakdown?.experienceMatch),
      domainMatch: clampNum(rawBreakdown?.domainMatch),
      seniorityMatch: clampNum(rawBreakdown?.seniorityMatch),
      overallFit: Math.min(clampNum(rawBreakdown?.overallFit), cap),
    },
    reasoning: String(parsed.reasoning || ''),
    highlights: Array.isArray(parsed.highlights) ? parsed.highlights.map(String) : [],
    concerns,
    matchedAt: new Date().toISOString(),
  };
}

function hasPaidAdvertisingEvidence(resumeText: string): boolean {
  const execution = /广告账户|媒体账户|广告投放|付费投放|信息流投放|搜索投放|投手|SEM\b/i.test(resumeText);
  const optimization = /预算|出价|竞价|消耗|素材测试|成本优化|CPC\b|CPM\b/i.test(resumeText);
  const outcome = /归因|ROI\b|ROAS\b|CPA\b|获客成本|转化成本/i.test(resumeText);
  return (execution && (optimization || outcome)) || (optimization && outcome);
}

function applyEvidenceCaps(resumeText: string, result: MatchingResult): MatchingResult {
  const targetsPaidAdvertising = hasCategory(result.jd, 'advertising')
    && /投放|广告|买量|SEM/i.test([
      result.jd.title,
      ...result.jd.responsibilities,
      ...result.jd.requirements,
    ].join('\n'));

  if (!targetsPaidAdvertising || hasPaidAdvertisingEvidence(resumeText) || result.score <= 69) {
    return result;
  }

  return {
    ...result,
    score: 69,
    breakdown: {
      ...result.breakdown,
      overallFit: Math.min(result.breakdown.overallFit, 69),
    },
    concerns: Array.from(new Set([
      ...result.concerns,
      '缺少广告账户、预算出价、归因或成本/ROI优化等实际投放闭环证据',
    ])),
  };
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function matchCacheKey(resumeText: string, candidates: JD[]): string {
  const jdFingerprint = candidates
    .map((jd) => `${jd.id}:${jd.updatedAt}:${jd.gap}:${jd.status}`)
    .join('|');
  return `${MATCH_CACHE_PREFIX}${MATCH_CACHE_VERSION}:${resumeText.length}:${stableHash(resumeText)}:${stableHash(jdFingerprint)}`;
}

function readCachedResults(key: string, resumeId: string): MatchingResult[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const cached = JSON.parse(raw) as { expiresAt?: number; results?: MatchingResult[] };
    if (!cached.expiresAt || cached.expiresAt <= Date.now() || !Array.isArray(cached.results)) {
      window.localStorage.removeItem(key);
      return null;
    }
    const matchedAt = new Date().toISOString();
    return cached.results.map((result) => ({
      ...result,
      id: `${resumeId}-${result.jdId}`,
      resumeId,
      matchedAt,
    }));
  } catch {
    return null;
  }
}

function writeCachedResults(key: string, results: MatchingResult[]): void {
  if (typeof window === 'undefined') return;
  try {
    const cacheKeys = Object.keys(window.localStorage)
      .filter((item) => item.startsWith(MATCH_CACHE_PREFIX))
      .sort((a, b) => {
        const aExpiry = JSON.parse(window.localStorage.getItem(a) || '{}').expiresAt || 0;
        const bExpiry = JSON.parse(window.localStorage.getItem(b) || '{}').expiresAt || 0;
        return aExpiry - bExpiry;
      });
    while (cacheKeys.length >= MAX_MATCH_CACHE_ENTRIES) {
      window.localStorage.removeItem(cacheKeys.shift()!);
    }
    window.localStorage.setItem(key, JSON.stringify({
      expiresAt: Date.now() + MATCH_CACHE_TTL_MS,
      results,
    }));
  } catch {
    // Storage can be unavailable or full; matching still works without the cache.
  }
}

function candidateLimit(total: number): number {
  return Math.min(total, MAX_AI_CANDIDATES);
}

function resultTokenBudget(count: number): number {
  return Math.min(6500, Math.max(2200, count * 240));
}

export async function matchResumeToJDs(
  resumeText: string, jds: JD[], resumeId: string, signal?: AbortSignal,
): Promise<MatchingResult[]> {
  if (jds.length === 0) return [];

  // 跳过无缺口岗位（缺口=0 表示不再招）
  const openJds = jds.filter(hasOpenGap);
  if (openJds.length === 0) return [];

  // 本地预筛：岗位过多时只把最相关的 Top N 交给 AI，避免超大 prompt + 输出截断
  // 传入候选人主职能分类：同类岗位获得大额加权，即使词面零重叠也保证进入 AI 候选集
  const candidates = prefilterJDs(resumeText, openJds, candidateLimit(openJds.length), detectResumeCategories(resumeText));

  // Single batch call for speed
  try {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const prompt = buildBatchMatchingPrompt(resumeText.slice(0, MAX_RESUME_CHARS), candidates);
    const content = await callAI([{ role: 'user', content: prompt }], signal, resultTokenBudget(candidates.length));
    const parsed = parseJson(content);

    if (parsed.results && Array.isArray(parsed.results)) {
      const results = (parsed.results as Array<Record<string, unknown>>)
        .map((r) => {
          const idx = Number(r.jdIndex) - 1;
          return candidates[idx] ? applyEvidenceCaps(resumeText, buildResult(candidates[idx], resumeId, r)) : null;
        })
        .filter((r): r is MatchingResult => r !== null)
        .sort((a, b) => b.score - a.score);
      const uniqueCount = new Set(results.map((result) => result.jdId)).size;
      if (uniqueCount !== candidates.length) {
        throw new Error(`Incomplete batch result: ${uniqueCount}/${candidates.length}`);
      }
      return results;
    }
    throw new Error('Unexpected response format');
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    console.warn('批量匹配解析失败，降级为逐个匹配', (err as Error)?.message);
    // Fallback to per-JD calls（已预筛，数量可控）
    try {
      return await matchPerJd(resumeText, candidates, resumeId, signal);
    } catch (err2) {
      console.warn('逐个匹配也失败', (err2 as Error)?.message);
      throw new Error('匹配服务暂不可用，请稍后重试');
    }
  }
}

export type OnResult = (result: MatchingResult) => void;

/**
 * 分批匹配：24 个候选岗位拆为三批并行分析，每批完成后立即回调给 UI。
 * 批次结果不完整时会自动降级为逐岗位分析，避免提前结束造成结果缺失。
 */
export async function matchResumeToJDsStream(
  resumeText: string, jds: JD[], resumeId: string, onResult: OnResult, signal?: AbortSignal,
): Promise<void> {
  if (jds.length === 0) return;

  // 跳过无缺口岗位（缺口=0 表示不再招）
  const openJds = jds.filter(hasOpenGap);
  if (openJds.length === 0) return;

  const candidates = prefilterJDs(resumeText, openJds, candidateLimit(openJds.length), detectResumeCategories(resumeText));
  const cacheKey = matchCacheKey(resumeText, candidates);
  const cachedResults = readCachedResults(cacheKey, resumeId);
  if (cachedResults) {
    cachedResults.forEach(onResult);
    return;
  }

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

  // All candidates share one AI comparison context. Independent batches use different
  // scoring baselines and can also disappear silently when one request fails.
  const results = await matchResumeToJDs(resumeText, candidates, resumeId, signal);
  if (results.length !== candidates.length) {
    throw new Error(`匹配结果不完整（${results.length}/${candidates.length}），请重试`);
  }

  writeCachedResults(cacheKey, results);
  results.forEach(onResult);
}

async function matchPerJd(
  resumeText: string, jds: JD[], resumeId: string, signal?: AbortSignal,
): Promise<MatchingResult[]> {
  const results: MatchingResult[] = [];
  for (let i = 0; i < jds.length; i += 3) {
    if (signal?.aborted) break;
    const batch = jds.slice(i, i + 3);
    const batchResults = await Promise.all(
      batch.map(async (jd) => {
        try {
          const prompt = buildMatchingPrompt(resumeText.slice(0, MAX_RESUME_CHARS), jd);
          const content = await callAI([{ role: 'user', content: prompt }], signal);
          return applyEvidenceCaps(resumeText, buildResult(jd, resumeId, parseJson(content)));
        } catch { return null; }
      }),
    );
    results.push(...batchResults.filter((result): result is MatchingResult => result !== null));
  }
  if (results.length === 0) throw new Error('匹配服务暂不可用，请稍后重试');
  return results.sort((a, b) => b.score - a.score);
}
