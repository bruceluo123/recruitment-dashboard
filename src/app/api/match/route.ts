import { NextRequest, NextResponse } from 'next/server';
import { guardApi } from '@/lib/api-guard';

const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

export const maxDuration = 60;

async function matchWithGemini(prompt: string, apiKey: string, maxTokens: number, signal: AbortSignal) {
  try {
    const response = await fetch(GEMINI_URL, {
      method: 'POST',
      signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: Math.min(Math.max(maxTokens, 1024), 8192),
          responseMimeType: 'application/json',
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    });
    if (!response.ok) {
      return NextResponse.json({ error: `DeepSeek 暂不可用，备用匹配服务也未完成（${response.status}），请稍后重试` }, { status: 503 });
    }
    const data = await response.json();
    const candidate = data?.candidates?.[0];
    const content = candidate?.content?.parts?.map((part: { text?: string }) => part.text || '').join('').trim();
    if (!content || !JSON.parse(content)) throw new Error('备用匹配结果不完整');
    console.warn('[match] Gemini fallback used');
    return NextResponse.json({
      model: 'gemini-2.5-flash', provider: 'gemini',
      choices: [{ message: { content }, finish_reason: candidate.finishReason === 'MAX_TOKENS' ? 'length' : 'stop' }],
    });
  } catch (error) {
    if (signal.aborted) throw error;
    return NextResponse.json({ error: 'DeepSeek 暂不可用，备用匹配服务也未完成，请稍后重试' }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const blocked = guardApi(req, 'match', 30, 60_000);
  if (blocked) return blocked;
  try {
    const body = await req.json();
    const apiKey = process.env.DEEPSEEK_API_KEY;
    // 默认使用 V4 Flash；旧环境变量若仍写 deepseek-chat，会在这里自动迁移到现行模型名。
    // 由客户端(body.model)决定模型，便于按任务选型；env 作兜底默认。
    const configuredModel = body.model || process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
    const model = configuredModel === 'deepseek-chat' ? 'deepseek-v4-flash' : configuredModel;

    if (!apiKey) {
      return NextResponse.json({ error: 'DeepSeek API Key 未配置' }, { status: 500 });
    }

    const stream = body.stream === true;
    const prompt = body.messages?.[0]?.content;
    const geminiKey = process.env.GEMINI_API_KEY;
    const canFallback = !stream && Boolean(geminiKey) && typeof prompt === 'string'
      && (prompt.startsWith('先形成统一的人选判断') || prompt.startsWith('对同一人选与以下'));
    const upstreamSignal = AbortSignal.any([req.signal, AbortSignal.timeout(canFallback ? 14_000 : 46_000)]);
    const requestBody = JSON.stringify({
      model,
      messages: body.messages,
      thinking: body.thinking ?? { type: 'disabled' },
      temperature: body.temperature ?? 0.3,
      max_tokens: body.max_tokens ?? 2000,
      ...(stream ? { stream: true } : {}),
    });
    const requestUpstream = () => fetch(DEEPSEEK_URL, {
      signal: upstreamSignal,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: requestBody,
    });
    let response: Response;
    try {
      response = await requestUpstream();
      for (let attempt = 1; attempt < (canFallback ? 2 : 3) && [429, 502, 503, 504].includes(response.status); attempt++) {
        await response.body?.cancel();
        await new Promise((resolve) => setTimeout(resolve, attempt * 600));
        upstreamSignal.throwIfAborted();
        response = await requestUpstream();
      }
    } catch (error) {
      if (!canFallback || req.signal.aborted) throw error;
      return matchWithGemini(prompt, geminiKey!, body.max_tokens ?? 2000, req.signal);
    }

    if (!response.ok) {
      if ([429, 502, 503, 504].includes(response.status)) {
        if (canFallback) {
          await response.body?.cancel();
          return matchWithGemini(prompt, geminiKey!, body.max_tokens ?? 2000, req.signal);
        }
        return NextResponse.json({ error: 'AI 匹配服务暂时繁忙，请稍后重试；简历和岗位数据未受影响' }, { status: 503 });
      }
      const errText = await response.text();
      return NextResponse.json({ error: `DeepSeek API ${response.status}: ${errText}` }, { status: response.status });
    }

    // 流式：直接把上游 SSE 字节透传给浏览器，前端边收边解析
    if (stream && response.body) {
      return new Response(response.body, {
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
        },
      });
    }

    try {
      const data = await response.json();
      if (canFallback && (typeof data?.choices?.[0]?.message?.content !== 'string'
        || data.choices[0].finish_reason === 'length')) {
        return matchWithGemini(prompt, geminiKey!, body.max_tokens ?? 2000, req.signal);
      }
      return NextResponse.json(data);
    } catch (error) {
      if (!canFallback || req.signal.aborted) throw error;
      return matchWithGemini(prompt, geminiKey!, body.max_tokens ?? 2000, req.signal);
    }
  } catch (err) {
    if ((err as Error).name === 'TimeoutError') {
      return NextResponse.json({ error: 'AI 匹配服务响应超时，请稍后重试；简历和岗位数据未受影响' }, { status: 503 });
    }
    return NextResponse.json({ error: `请求失败: ${(err as Error).message}` }, { status: 500 });
  }
}
