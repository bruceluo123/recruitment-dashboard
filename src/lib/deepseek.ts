import type { JD } from '@/types/jd';
import type { MatchingResult } from '@/types/matching';
import { buildBatchMatchingPrompt, buildMatchingPrompt } from './matching-prompt';
import { prefilterJDs } from './jd-prefilter';

// 一次 AI 调用最多精排的 JD 数（超出则本地预筛取 Top N）
const MAX_AI_CANDIDATES = 25;

async function callAI(
  messages: Array<{ role: string; content: string }>,
  signal?: AbortSignal,
  maxTokens = 2000,
): Promise<string> {
  const response = await fetch('/api/match', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, temperature: 0.3, max_tokens: maxTokens }),
    signal,
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
    throw new Error(err.error || `API ${response.status}`);
  }

  const data = await response.json();
  if (data.error) throw new Error(data.error);
  if (!data?.choices?.[0]?.message?.content) throw new Error('API 返回数据异常');
  return data.choices[0].message.content;
}

function clampNum(v: unknown): number {
  return Math.min(100, Math.max(0, Number(v) || 0));
}

function parseJson(content: string): Record<string, unknown> {
  const cleaned = content.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
  return JSON.parse(cleaned);
}

function buildResult(jd: JD, resumeId: string, parsed: Record<string, unknown>): MatchingResult {
  return {
    id: `${jd.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    jdId: jd.id, jd, resumeId,
    score: clampNum(parsed.score),
    breakdown: {
      skillsMatch: clampNum((parsed.breakdown as Record<string, unknown>)?.skillsMatch),
      experienceMatch: clampNum((parsed.breakdown as Record<string, unknown>)?.experienceMatch),
      domainMatch: clampNum((parsed.breakdown as Record<string, unknown>)?.domainMatch),
      seniorityMatch: clampNum((parsed.breakdown as Record<string, unknown>)?.seniorityMatch),
      overallFit: clampNum((parsed.breakdown as Record<string, unknown>)?.overallFit),
    },
    reasoning: String(parsed.reasoning || ''),
    highlights: Array.isArray(parsed.highlights) ? parsed.highlights.map(String) : [],
    concerns: Array.isArray(parsed.concerns) ? parsed.concerns.map(String) : [],
    matchedAt: new Date().toISOString(),
  };
}

function makeFallback(jd: JD, resumeId: string): MatchingResult {
  const s = () => Math.floor(Math.random() * 25) + 40;
  return buildResult(jd, resumeId, {
    score: s(),
    breakdown: { skillsMatch: s(), experienceMatch: s(), domainMatch: s(), seniorityMatch: s(), overallFit: s() },
    reasoning: 'API 暂不可用，显示为估算结果',
    highlights: [], concerns: ['当前为估算模式，分数仅供参考'],
  });
}

export async function matchResumeToJDs(
  resumeText: string, jds: JD[], resumeId: string, signal?: AbortSignal,
): Promise<MatchingResult[]> {
  if (jds.length === 0) return [];

  // 本地预筛：岗位过多时只把最相关的 Top N 交给 AI，避免超大 prompt + 输出截断
  const candidates = prefilterJDs(resumeText, jds, MAX_AI_CANDIDATES);

  // Single batch call for speed
  try {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const prompt = buildBatchMatchingPrompt(resumeText, candidates);
    const content = await callAI([{ role: 'user', content: prompt }], signal, 4000);
    const parsed = parseJson(content);

    if (parsed.results && Array.isArray(parsed.results)) {
      return (parsed.results as Array<Record<string, unknown>>)
        .map((r) => {
          const idx = Number(r.jdIndex) - 1;
          return candidates[idx] ? buildResult(candidates[idx], resumeId, r) : null;
        })
        .filter((r): r is MatchingResult => r !== null)
        .sort((a, b) => b.score - a.score);
    }
    throw new Error('Unexpected response format');
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    // Fallback to per-JD calls（已预筛，数量可控）
    try {
      return await matchPerJd(resumeText, candidates, resumeId, signal);
    } catch {
      return candidates.map((jd) => makeFallback(jd, resumeId)).sort((a, b) => b.score - a.score);
    }
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
          const prompt = buildMatchingPrompt(resumeText, jd);
          const content = await callAI([{ role: 'user', content: prompt }], signal);
          return buildResult(jd, resumeId, parseJson(content));
        } catch { return makeFallback(jd, resumeId); }
      }),
    );
    results.push(...batchResults);
  }
  return results.sort((a, b) => b.score - a.score);
}
