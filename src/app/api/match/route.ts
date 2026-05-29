import { NextRequest, NextResponse } from 'next/server';

const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const apiKey = process.env.DEEPSEEK_API_KEY;
    // 默认用非推理快速模型 deepseek-chat（V3）。推理模型(如deepseek-v4-pro/reasoner)会把 token 预算耗在思考上、又慢又可能空输出。
    // 由客户端(body.model)决定模型，便于按任务选型；env 作兜底默认。
    const model = body.model || process.env.DEEPSEEK_MODEL || 'deepseek-chat';

    if (!apiKey) {
      return NextResponse.json({ error: 'DeepSeek API Key 未配置' }, { status: 500 });
    }

    const response = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: body.messages,
        temperature: body.temperature ?? 0.3,
        max_tokens: body.max_tokens ?? 2000,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return NextResponse.json({ error: `DeepSeek API ${response.status}: ${errText}` }, { status: response.status });
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: `请求失败: ${(err as Error).message}` }, { status: 500 });
  }
}
