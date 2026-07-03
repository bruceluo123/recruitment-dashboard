import { NextRequest, NextResponse } from 'next/server'
import { guardApi } from '@/lib/api-guard'

const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions'

/**
 * 话术生成代理路由 — 转发到 DeepSeek API（OpenAI 兼容格式）
 * 接收：{ messages: [...], max_tokens?: number }
 * 返回：DeepSeek 原始响应（choices[0].message.content 为生成内容）
 */
export async function POST(req: NextRequest) {
  const blocked = guardApi(req, 'claude', 30, 60_000)
  if (blocked) return blocked
  const apiKey = process.env.DEEPSEEK_API_KEY

  if (!apiKey) {
    return NextResponse.json(
      { error: 'DEEPSEEK_API_KEY 未配置，请在 Vercel 环境变量或 .env.local 中设置' },
      { status: 500 }
    )
  }

  let body: { messages?: unknown; max_tokens?: number }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '请求体格式错误' }, { status: 400 })
  }

  const upstream = await fetch(DEEPSEEK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: body.messages,
      temperature: 0.7,
      max_tokens: body.max_tokens ?? 1000,
    }),
  })

  const data = await upstream.json()
  return NextResponse.json(data, { status: upstream.status })
}
