import { NextRequest, NextResponse } from 'next/server';
import { permittedOwners, requireMutationSession } from '@/lib/auth-api';
import { canAccessRecord } from '@/lib/data-ownership';
import { kvGetRaw, kvTransaction } from '@/lib/kv-server';

export const dynamic = 'force-dynamic';

const TYPES = new Set(['jds', 'candidates', 'talents', 'repush', 'todos', 'companies', 'performance']);

function updatedAt(value: unknown): number {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 0;
  const raw = (value as { updatedAt?: unknown }).updatedAt;
  if (typeof raw !== 'string') return 0;
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

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
      for (let attempt = 0; attempt < 3; attempt++) {
        const raw = await kvGetRaw(key);
        const current = raw ? JSON.parse(raw) as Array<{ id: string }> : [];
        if (!Array.isArray(current)) throw new Error('云端数据格式异常');
        const incoming = new Map(rows.map((row) => [(row as { id: string }).id, row]));
        let changed = 0;
        const merged = current.map((row) => {
          const local = incoming.get(row.id);
          incoming.delete(row.id);
          if (type === 'jds' && local && updatedAt(local) > updatedAt(row)) {
            changed++;
            return local;
          }
          return row;
        });
        const additions = Array.from(incoming.values());
        changed += additions.length;
        if (!changed) break;
        const committed = await kvTransaction({
          expected: [{ key, exists: Boolean(raw), ...(raw ? { value: raw } : {}) }],
          writes: [{ key, value: JSON.stringify([...merged, ...additions]) }],
          increments: ['recruit:version'],
        });
        if (committed.ok) { restored += changed; break; }
      }
    }
    return NextResponse.json({ ok: true, restored }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: '本机数据恢复未完成，已保留本机数据' }, { status: 503 });
  }
}
