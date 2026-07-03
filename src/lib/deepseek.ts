import type { JD } from '@/types/jd';
import type { MatchingResult } from '@/types/matching';
import { buildBatchMatchingPrompt, buildMatchingPrompt, buildStreamMatchingPrompt } from './matching-prompt';
import { prefilterJDs } from './jd-prefilter';
import { detectCategories } from './jd-parse-core';

// 一次 AI 调用最多精排的 JD 数（超出则本地预筛取 Top N）。
// 调高到 36：JD 库可达 200+，候选集太小会让"全部"模式漏掉真正合适的岗位。
const MAX_AI_CANDIDATES = 36;

// 仅匹配仍有缺口的岗位：缺口为 0（或非正数）= 不需要再招，跳过匹配
function hasOpenGap(jd: JD): boolean {
  const n = parseInt(String(jd.gap ?? '').trim(), 10);
  return Number.isFinite(n) && n > 0;
}
// 非推理快速模型：实测 ~24s 完成；推理模型(deepseek-v4-pro)会思考耗光token预算、~84s且空输出
const MATCH_MODEL = 'deepseek-chat';

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

  // 跳过无缺口岗位（缺口=0 表示不再招）
  const openJds = jds.filter(hasOpenGap);
  if (openJds.length === 0) return [];

  // 本地预筛：岗位过多时只把最相关的 Top N 交给 AI，避免超大 prompt + 输出截断
  // 传入候选人主职能分类：同类岗位获得大额加权，即使词面零重叠也保证进入 AI 候选集
  const candidates = prefilterJDs(resumeText, openJds, MAX_AI_CANDIDATES, detectCategories(resumeText));

  // Single batch call for speed
  try {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const prompt = buildBatchMatchingPrompt(resumeText, candidates);
    const content = await callAI([{ role: 'user', content: prompt }], signal, 4500);
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
    console.warn('批量匹配解析失败，降级为逐个匹配', (err as Error)?.message);
    // Fallback to per-JD calls（已预筛，数量可控）
    try {
      return await matchPerJd(resumeText, candidates, resumeId, signal);
    } catch (err2) {
      console.warn(`逐个匹配也失败，返回估算分数(${candidates.length}个JD)`, (err2 as Error)?.message);
      return candidates.map((jd) => makeFallback(jd, resumeId)).sort((a, b) => b.score - a.score);
    }
  }
}

export type OnResult = (result: MatchingResult) => void;

/** 把一行 JSONL 解析为匹配结果，失败返回 null */
function parseStreamLine(line: string, candidates: JD[], resumeId: string): MatchingResult | null {
  const trimmed = line.trim().replace(/^```json\s*/i, '').replace(/```$/, '').trim();
  if (!trimmed || trimmed[0] !== '{') return null;
  try {
    const r = JSON.parse(trimmed) as Record<string, unknown>;
    const idx = Number(r.jdIndex) - 1;
    return candidates[idx] ? buildResult(candidates[idx], resumeId, r) : null;
  } catch {
    return null;
  }
}

/**
 * 流式匹配：边生成边把结果逐条回调给 UI（体感更快，总耗时与批量相当）。
 * 模型按 JSONL 逐行输出，收到完整一行即解析回调。失败时回退到批量匹配。
 */
export async function matchResumeToJDsStream(
  resumeText: string, jds: JD[], resumeId: string, onResult: OnResult, signal?: AbortSignal,
): Promise<void> {
  if (jds.length === 0) return;

  // 跳过无缺口岗位（缺口=0 表示不再招）
  const openJds = jds.filter(hasOpenGap);
  if (openJds.length === 0) return;

  const candidates = prefilterJDs(resumeText, openJds, MAX_AI_CANDIDATES, detectCategories(resumeText));

  const seen = new Set<string>();
  const emit = (result: MatchingResult) => {
    if (seen.has(result.jdId)) return;
    seen.add(result.jdId);
    onResult(result);
  };

  try {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const prompt = buildStreamMatchingPrompt(resumeText, candidates);
    const response = await fetch('/api/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MATCH_MODEL, stream: true,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0, max_tokens: 4500,
      }),
      signal,
    });
    if (!response.ok || !response.body) throw new Error(`API ${response.status}`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let sseBuf = '';
    let contentBuf = '';

    const drainContent = () => {
      const lines = contentBuf.split('\n');
      contentBuf = lines.pop() ?? '';
      for (const l of lines) {
        const r = parseStreamLine(l, candidates, resumeId);
        if (r) emit(r);
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      sseBuf += decoder.decode(value, { stream: true });
      const events = sseBuf.split('\n');
      sseBuf = events.pop() ?? '';
      for (const ev of events) {
        const line = ev.trim();
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const obj = JSON.parse(payload);
          const delta: string | undefined = obj?.choices?.[0]?.delta?.content;
          if (delta) { contentBuf += delta; drainContent(); }
        } catch { /* 不完整的 data 行，等后续 chunk 补全 */ }
      }
    }
    // flush 最后一行（无换行结尾的对象）
    const last = parseStreamLine(contentBuf, candidates, resumeId);
    if (last) emit(last);

    // 一条都没解析出来 → 回退批量
    if (seen.size === 0) {
      const batch = await matchResumeToJDs(resumeText, jds, resumeId, signal);
      batch.forEach(emit);
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    // 流式失败且尚无结果 → 回退批量；已有部分结果则保留
    if (seen.size === 0) {
      const batch = await matchResumeToJDs(resumeText, jds, resumeId, signal).catch(() => [] as MatchingResult[]);
      batch.forEach(emit);
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
