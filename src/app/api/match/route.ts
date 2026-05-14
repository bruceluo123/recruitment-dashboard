import { NextRequest, NextResponse } from 'next/server';

const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';
const API_KEY = 'sk-4bad484c2c3e41c2b627cd6d3cb6c3ef';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const response = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
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
