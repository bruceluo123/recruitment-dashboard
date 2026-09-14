import { NextRequest, NextResponse } from 'next/server';
import { rateLimit, clientIp } from '@/lib/api-guard';
import { requireMutationSession } from '@/lib/auth-api';
import { kvSetRaw } from '@/lib/kv-server';

export const dynamic = 'force-dynamic';

// 侧信道键白名单：客户端只传符号名，真实 KV 键名只存在于服务端，
// 与 /api/data 的 6 类主数据键分开管理（那些走 /api/data，这些走这里）。
const SIDE_KEYS: Record<string, string> = {
  'last-import-diff': 'recruit:last-import-diff',
  'weekly-added': 'recruit:weekly-added',
};

export async function POST(req: NextRequest) {
  const blocked = await requireMutationSession(req);
  if (blocked) return blocked;
  if (!rateLimit(`sync-write:${clientIp(req)}`, 60, 60_000)) {
    return NextResponse.json({ error: '写入过于频繁' }, { status: 429 });
  }
  try {
    const { op, key, value } = (await req.json()) as { op?: string; key?: string; value?: string };
    const realKey = key ? SIDE_KEYS[key] : undefined;
    if (!realKey) return NextResponse.json({ error: `未知键: ${key}` }, { status: 400 });

    if (op === 'set') {
      if (typeof value !== 'string') return NextResponse.json({ error: '缺少 value' }, { status: 400 });
      const ok = await kvSetRaw(realKey, value);
      if (!ok) return NextResponse.json({ error: 'set 失败' }, { status: 500 });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: `未知操作: ${op}` }, { status: 400 });
  } catch {
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}
