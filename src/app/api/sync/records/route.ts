import { NextRequest, NextResponse } from 'next/server';
import { guardApi } from '@/lib/api-guard';
import { hasValidServiceToken, permittedOwners, requireMutationSession } from '@/lib/auth-api';
import { canAccessRecord } from '@/lib/data-ownership';
import { kvCommandStrict, kvTransaction } from '@/lib/kv-server';
import { applyRecordChanges, recordsEqual, type RecordChange, type SyncRecord } from '@/lib/record-changes';
export const dynamic = 'force-dynamic';
const TYPES = new Set(['jds', 'candidates', 'talents', 'repush', 'todos', 'companies', 'performance']);
const REPUSH_DELIVERY_FIELDS = [
  'deliveryId',
  'deliveryIndex',
  'deliveryStatus',
  'deliveryUpdatedAt',
  'telegramMessageId',
  'deliveredAt',
] as const;
function validRecord(value: unknown, id: string): boolean {
  return value === null || (!!value && typeof value === 'object' && !Array.isArray(value)
    && (value as SyncRecord).id === id && Object.keys(value).every((key) => !['__proto__', 'prototype', 'constructor'].includes(key)));
}
export async function POST(request: NextRequest) {
  const unauthorized = await requireMutationSession(request);
  if (unauthorized) return unauthorized;
  const owners = await permittedOwners(request);
  if (!owners) return NextResponse.json({ error: '未授权，请先登录' }, { status: 401 });
  const blocked = hasValidServiceToken(request) ? null : guardApi(request, 'sync-records', 120, 60_000);
  if (blocked) return blocked;
  try {
    const { type, mutationId, changes, resolution, jdEpoch } = await request.json() as {
      type: string;
      mutationId: string;
      changes: RecordChange[];
      resolution?: 'local';
      jdEpoch?: string;
    };
    if (!TYPES.has(type) || !/^[a-zA-Z0-9-]{8,80}$/.test(mutationId || '')
      || (resolution !== undefined && resolution !== 'local')
      || !Array.isArray(changes) || changes.length > 5000 || changes.some((change) => !change
        || typeof change.id !== 'string' || !change.id || !validRecord(change.before, change.id)
        || !validRecord(change.after, change.id) || (!change.before && !change.after))) {
      return NextResponse.json({ error: '更新格式无效' }, { status: 400 });
    }
    const key = `recruit:${type}`, receipt = `recruit:mutation:${mutationId}`;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (await kvCommandStrict<number>('EXISTS', receipt)) return NextResponse.json({ ok: true });
      const [raw, tombRaw, epochRaw] = await Promise.all([
        kvCommandStrict<string | null>('GET', key), kvCommandStrict<string | null>('GET', 'recruit:tombstones'),
        type === 'jds' ? kvCommandStrict<string | null>('GET', 'recruit:jds-epoch') : Promise.resolve(null),
      ]);
      if (type === 'jds' && jdEpoch !== (epochRaw || '0')) {
        return NextResponse.json({ code: 'JD_SNAPSHOT_EXPIRED', error: '岗位库已更新，旧版本修改已拦截，请采用云端最新岗位' }, { status: 409 });
      }
      const current = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(current)) throw new Error('远端数据格式异常，已停止保存');
      const currentById = new Map(current.map((record: SyncRecord) => [record.id, record]));
      const forbidden = changes.flatMap((change) => {
        const stored = currentById.get(change.id);
        return (stored && !canAccessRecord(type, stored, owners))
          || (change.after && !canAccessRecord(type, change.after, owners))
          ? [change.id]
          : [];
      });
      if (forbidden.length) {
        return NextResponse.json({
          error: '无权修改该所属人的数据',
          forbidden: Array.from(new Set(forbidden)),
        }, { status: 403 });
      }
      if (type === 'repush') {
        const protectedConflicts = changes.flatMap((change) => {
          const stored = currentById.get(change.id);
          if (!change.after && stored && (stored.deliveryStatus === 'queued' || stored.deliveryStatus === 'sending')) return [change.id];
          if (!change.before || !change.after) return [];
          return REPUSH_DELIVERY_FIELDS.some((field) => !recordsEqual(change.before?.[field], change.after?.[field]))
            ? [change.id]
            : [];
        });
        if (protectedConflicts.length) {
          return NextResponse.json({
            error: '发送状态由发送器维护；已保留人工填写内容，请采用云端送达状态',
            conflicts: Array.from(new Set(protectedConflicts)),
          }, { status: 409 });
        }
      }
      const tombstones = tombRaw ? JSON.parse(tombRaw) : {};
      const resurrected = resolution === 'local' && type !== 'jds'
        ? []
        : changes.filter((change) => change.after && tombstones[type]?.[change.id]).map((change) => change.id);
      const result = applyRecordChanges(current, changes);
      if (type === 'jds' && resurrected.length) {
        return NextResponse.json({ code: 'JD_SNAPSHOT_EXPIRED', error: '已拦截被移除岗位的恢复，请通过新的完整面板导入恢复在招岗位' }, { status: 409 });
      }
      const conflicts = Array.from(new Set([...resurrected, ...result.conflicts]));
      if (conflicts.length) return NextResponse.json({ error: '其他设备已修改这些记录，本次修改已保留，请核对后再保存', conflicts }, { status: 409 });
      for (const change of changes) if (!change.after) {
        tombstones[type] ||= {};
        tombstones[type][change.id] = Date.now();
      }
      if (resolution === 'local' && type !== 'jds' && tombstones[type]) {
        for (const change of changes) if (change.after) delete tombstones[type][change.id];
      }
      const committed = await kvTransaction({
        expected: [
          ...(type === 'jds' ? [{ key: 'recruit:jds-epoch', exists: epochRaw !== null, ...(epochRaw !== null ? { value: epochRaw } : {}) }] : []),
          { key, exists: Boolean(raw), ...(raw ? { value: raw } : {}) },
          { key: 'recruit:tombstones', exists: Boolean(tombRaw), ...(tombRaw ? { value: tombRaw } : {}) },
          { key: receipt, exists: false },
        ],
        writes: [
          { key, value: JSON.stringify(result.records) },
          { key: 'recruit:tombstones', value: JSON.stringify(tombstones) },
          { key: receipt, value: '1', ttlSeconds: 604800 },
        ],
        increments: ['recruit:version'],
      });
      if (committed.ok) return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: '保存遇到并发更新，请重试' }, { status: 409 });
  } catch {
    return NextResponse.json({ error: '保存未完成，修改仍保留在本机，请重试' }, { status: 503 });
  }
}
