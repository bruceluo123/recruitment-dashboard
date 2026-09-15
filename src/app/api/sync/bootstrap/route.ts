import { NextRequest, NextResponse } from 'next/server';
import { permittedOwners, requireMutationSession } from '@/lib/auth-api';
import { canAccessRecord } from '@/lib/data-ownership';
import { kvCommandStrict, kvTransaction } from '@/lib/kv-server';

export const dynamic = 'force-dynamic';

// 兼容旧客户端恢复请求；岗位与推荐缓存不能恢复成新增记录或发送状态。
const TYPES = new Set(['candidates', 'talents', 'todos', 'companies', 'performance']);

export async function POST(request: NextRequest) {
  const unauthorized = await requireMutationSession(request);
  if (unauthorized) return unauthorized;
  const owners = await permittedOwners(request);
  if (!owners) return NextResponse.json({ error: '未授权，请先登录' }, { status: 401 });

  try {
    const body = await request.json() as { data?: Record<string, unknown> };
    const entries = Object.entries(body.data || {}).filter(([type, rows]) => (
      TYPES.has(type) && Array.isArray(rows) && rows.length > 0 && rows.length <= 10_000
    ));
    let restored = 0;
    for (const [type, rowsValue] of entries) {
      const rows = (rowsValue as unknown[]).filter((row) => row && typeof row === 'object' && !Array.isArray(row)
        && typeof (row as { id?: unknown }).id === 'string' && canAccessRecord(type, row, owners));
      if (!rows.length) continue;
      const key = `recruit:${type}`;
      let completed = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        const [raw, tombRaw] = await kvCommandStrict<(string | null)[]>('MGET', key, 'recruit:tombstones');
        const current = raw ? JSON.parse(raw) as Array<{ id: string }> : [];
        if (!Array.isArray(current)) throw new Error('云端数据格式异常');
        const tombstones = tombRaw ? JSON.parse(tombRaw) as Record<string, Record<string, number>> : {};
        if (!tombstones || typeof tombstones !== 'object' || Array.isArray(tombstones)) throw new Error('删除记录格式异常');
        const incoming = new Map(rows.map((row) => [(row as { id: string }).id, row]));
        const merged = current.map((row) => {
          incoming.delete(row.id);
          return row;
        });
        const additions = Array.from(incoming.entries())
          .filter(([id]) => !tombstones[type]?.[id]).map(([, row]) => row);
        if (!additions.length) { completed = true; break; }
        const committed = await kvTransaction({
          expected: [
            { key, exists: raw !== null, ...(raw !== null ? { value: raw } : {}) },
            { key: 'recruit:tombstones', exists: tombRaw !== null, ...(tombRaw !== null ? { value: tombRaw } : {}) },
          ],
          writes: [{ key, value: JSON.stringify([...merged, ...additions]) }],
          increments: ['recruit:version'],
        });
        if (committed.ok) { restored += additions.length; completed = true; break; }
      }
      if (!completed) throw new Error('初始化恢复遇到并发更新');
    }
    return NextResponse.json({ ok: true, restored }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: '本机数据恢复未完成，已保留本机数据' }, { status: 503 });
  }
}
