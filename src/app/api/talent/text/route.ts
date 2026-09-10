import { NextRequest, NextResponse } from 'next/server';
import { kvCommandStrict, kvGetRaw, kvSetRaw, kvConfigured, talentTextKey } from '@/lib/kv-server';

export const runtime = 'nodejs';

// GET /api/talent/text?id=<talentId> → 返回已存储的简历文字
export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: '缺少 id' }, { status: 400 });
  if (!kvConfigured()) return NextResponse.json({ error: 'KV 未配置' }, { status: 503 });

  const text = await kvGetRaw(talentTextKey(id));
  return NextResponse.json({ id, text: text ?? '', chars: text ? text.replace(/\s+/g, '').length : 0 });
}

// POST /api/talent/text {id, text} → 保存简历文字
export async function POST(request: NextRequest) {
  if (!kvConfigured()) return NextResponse.json({ error: 'KV 未配置' }, { status: 503 });
  try {
    const body = (await request.json()) as { id?: string; text?: string; ids?: unknown };
    if (Array.isArray(body.ids)) {
      const ids = Array.from(new Set(body.ids.map(String).map((id) => id.trim()).filter(Boolean))).slice(0, 100);
      if (!ids.length) return NextResponse.json({ items: [] });
      const values = await kvCommandStrict<Array<string | null>>('MGET', ...ids.map(talentTextKey));
      return NextResponse.json({
        items: ids.map((id, index) => ({ id, text: values[index] || '' })),
      });
    }
    const { id, text } = body;
    if (!id || typeof text !== 'string') return NextResponse.json({ error: '参数缺失' }, { status: 400 });
    const ok = await kvSetRaw(talentTextKey(id), text);
    if (!ok) return NextResponse.json({ error: '保存失败' }, { status: 500 });
    return NextResponse.json({ ok: true, id, chars: text.replace(/\s+/g, '').length });
  } catch (err) {
    return NextResponse.json({ error: `保存失败: ${(err as Error).message}` }, { status: 500 });
  }
}
