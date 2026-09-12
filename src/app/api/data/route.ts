import { NextRequest, NextResponse } from 'next/server';
import { permittedOwners, requireApiSession, requireMutationSession } from '@/lib/auth-api';
import { filterAccessibleRecords } from '@/lib/data-ownership';
import { kvCommandStrict } from '@/lib/kv-server';

export const dynamic = 'force-dynamic';

// 全部业务数据的 KV 键映射（与 src/lib/sync.ts 保持一致）。
const SYNC_KEYS: Record<string, string> = {
  jds: 'recruit:jds',
  candidates: 'recruit:candidates',
  talents: 'recruit:talents',
  repush: 'recruit:repush',
  todos: 'recruit:todos',
  companies: 'recruit:companies',
  performance: 'recruit:performance',
};

export async function GET(request: NextRequest) {
  const unauthorized = await requireApiSession(request);
  if (unauthorized) return unauthorized;
  const owners = await permittedOwners(request);
  if (!owners) return NextResponse.json({ error: '未授权，请先登录' }, { status: 401 });
  const type = request.nextUrl.searchParams.get('type') || '';
  const key = SYNC_KEYS[type];
  if (!key) return NextResponse.json({ error: '必须指定有效的数据类型' }, { status: 400 });
  try {
    const [raw, rawVer] = await Promise.all([
      kvCommandStrict<string | null>('GET', key),
      kvCommandStrict<string | null>('GET', 'recruit:version'),
    ]);
    const stored = safeParse(raw) || [];
    if (!Array.isArray(stored)) throw new Error('远端数据格式异常');
    return NextResponse.json({
      [type]: filterAccessibleRecords(type, stored, owners),
      version: parseInt(rawVer || '0') || 0,
    });
  } catch {
    return NextResponse.json({ error: '数据读取失败，已保留上次结果' }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const blocked = await requireMutationSession(req);
  if (blocked) return blocked;
  return NextResponse.json(
    { error: '整组写入已停用，请使用记录级同步接口' },
    { status: 410 },
  );
}

function safeParse(raw: string | null): unknown {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
