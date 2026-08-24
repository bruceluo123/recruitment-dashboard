import { NextRequest, NextResponse } from 'next/server';
import { guardApi } from '@/lib/api-guard';

const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';

export const maxDuration = 60;

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
    const response = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: body.messages,
        thinking: body.thinking ?? { type: 'disabled' },
        temperature: body.temperature ?? 0.3,
        max_tokens: body.max_tokens ?? 2000,
        ...(stream ? { stream: true } : {}),
      }),
    });

    if (!response.ok) {
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

    const data = await response.json();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: `请求失败: ${(err as Error).message}` }, { status: 500 });
  }
}
