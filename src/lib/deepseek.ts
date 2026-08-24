import type { JD } from '@/types/jd';
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
const MATCH_BATCH_SIZE = 8;

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
    id: `${jd.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
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

function candidateLimit(total: number): number {
  return Math.min(total, MAX_AI_CANDIDATES);
}

function resultTokenBudget(count: number): number {
  return Math.min(4500, Math.max(1800, count * 180));
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
          return candidates[idx] ? buildResult(candidates[idx], resumeId, r) : null;
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

  const seen = new Set<string>();
  const emit = (result: MatchingResult) => {
    if (seen.has(result.jdId)) return;
    seen.add(result.jdId);
    onResult(result);
  };

  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const batches: JD[][] = [];
  for (let index = 0; index < candidates.length; index += MATCH_BATCH_SIZE) {
    batches.push(candidates.slice(index, index + MATCH_BATCH_SIZE));
  }

  const outcomes = await Promise.all(batches.map(async (batch) => {
    try {
      const results = await matchResumeToJDs(resumeText, batch, resumeId, signal);
      results.forEach(emit);
      return true;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      return false;
    }
  }));

  if (seen.size === 0 && !outcomes.some(Boolean)) {
    throw new Error('匹配服务暂不可用，请稍后重试');
  }
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
          return buildResult(jd, resumeId, parseJson(content));
        } catch { return null; }
      }),
    );
    results.push(...batchResults.filter((result): result is MatchingResult => result !== null));
  }
  if (results.length === 0) throw new Error('匹配服务暂不可用，请稍后重试');
  return results.sort((a, b) => b.score - a.score);
}
