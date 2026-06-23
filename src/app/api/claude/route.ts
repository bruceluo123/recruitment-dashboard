import { NextRequest, NextResponse } from 'next/server'

/**
 * Anthropic API 代理路由
 * 优先使用环境变量 ANTHROPIC_API_KEY，允许客户端通过 x-api-key header 传入备用 key（仅用于演示）
 */
export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY || req.headers.get('x-api-key') || ''

  if (!apiKey) {
    return NextResponse.json(
      { error: { message: 'API key 未配置，请在页面右上角配置 Anthropic API Key 或设置环境变量 ANTHROPIC_API_KEY' } },
      { status: 401 }
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: { message: '请求体格式错误' } }, { status: 400 })
  }

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  })

  const data = await upstream.json()
  return NextResponse.json(data, { status: upstream.status })
}
