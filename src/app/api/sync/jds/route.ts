import { createHash, randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireApiSession, requireMutationSession } from '@/lib/auth-api';
import { kvCommandStrict, kvTransaction } from '@/lib/kv-server';
import { getJDKey } from '@/lib/jd-parse-core';
import type { JD } from '@/types/jd';

export const dynamic = 'force-dynamic';
const KEY = 'recruit:jds';
const EPOCH = 'recruit:jds-epoch';
const TOMBS = 'recruit:tombstones';
const revision = (raw: string | null) => createHash('sha256').update(raw ?? 'null').digest('hex');

function parseRows(raw: string | null): JD[] {
  const rows: unknown = raw === null ? [] : JSON.parse(raw);
  if (!Array.isArray(rows)) throw new Error('岗位库格式异常');
  return rows;
}

export async function GET(request: NextRequest) {
  const denied = await requireApiSession(request);
  if (denied) return denied;
  try {
    const mutationId = request.nextUrl.searchParams.get('mutationId');
    if (mutationId !== null) {
      if (!/^[a-zA-Z0-9-]{8,80}$/.test(mutationId)) return NextResponse.json({ error: '无效导入编号' }, { status: 400 });
      const [raw, epoch, receiptRaw] = await kvCommandStrict<(string | null)[]>('MGET', KEY, EPOCH, `recruit:jd-import:${mutationId}`);
      if (!receiptRaw) return NextResponse.json({ status: 'unconfirmed' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
      const receipt = JSON.parse(receiptRaw);
      if (receipt.epoch !== epoch) return NextResponse.json({ status: 'superseded', error: '本次导入已保存，但已有更新的岗位版本，请刷新查看' }, { status: 409 });
      const unchanged = revision(raw) === receipt.payloadHash;
      return NextResponse.json({ ok: true, epoch, unchanged, ...(unchanged ? {} : { jds: parseRows(raw) }) }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const [raw, epoch] = await kvCommandStrict<(string | null)[]>('MGET', KEY, EPOCH);
    return NextResponse.json({ jds: parseRows(raw), revision: revision(raw), epoch: epoch || '0' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: '无法读取当前云端岗位，已停止覆盖' }, { status: 503 });
  }
}

/** 完整面板、删除标记、代次和覆盖前快照必须在同一事务内提交。 */
export async function POST(request: NextRequest) {
  const denied = await requireMutationSession(request);
  if (denied) return denied;
  try {
    const body = await request.json() as { jds: JD[]; revision: string; epoch: string; mutationId: string };
    if (!/^[a-zA-Z0-9-]{8,80}$/.test(body.mutationId || '') || typeof body.revision !== 'string'
      || typeof body.epoch !== 'string' || !Array.isArray(body.jds) || !body.jds.length || body.jds.length > 5000
      || body.jds.some((row) => !row || typeof row.id !== 'string' || !row.id || typeof row.title !== 'string'
        || !row.title.trim() || !Array.isArray(row.categories) || !Array.isArray(row.responsibilities) || !Array.isArray(row.requirements))) {
      return NextResponse.json({ error: '完整岗位数据无效，原岗位库未修改' }, { status: 400 });
    }
    if (new Set(body.jds.map((row) => row.id)).size !== body.jds.length) {
      return NextResponse.json({ error: '导入岗位存在重复 ID，原岗位库未修改，请刷新后重试' }, { status: 400 });
    }
    if (new Set(body.jds.map(getJDKey)).size !== body.jds.length) {
      return NextResponse.json({ error: '导入岗位存在重复岗位键，原岗位库未修改，请检查需求Key' }, { status: 400 });
    }
    const receipt = `recruit:jd-import:${body.mutationId}`;
    const payloadHash = revision(JSON.stringify(body.jds));
    for (let attempt = 0; attempt < 3; attempt++) {
      const [raw, epoch, tombRaw, receiptRaw] = await kvCommandStrict<(string | null)[]>('MGET', KEY, EPOCH, TOMBS, receipt);
      if (receiptRaw) {
        const saved = JSON.parse(receiptRaw);
        if (saved.payloadHash !== payloadHash || saved.epoch !== epoch) {
          return NextResponse.json({ error: '该导入已被后续版本取代，请重新读取岗位' }, { status: 409 });
        }
        const unchanged = revision(raw) === payloadHash;
        return NextResponse.json({ ok: true, epoch, unchanged, ...(unchanged ? {} : { jds: parseRows(raw) }) });
      }
      if (revision(raw) !== body.revision || (epoch || '0') !== body.epoch) {
        return NextResponse.json({ error: '导入期间云端岗位发生变化，本次未覆盖，请重新导入' }, { status: 409 });
      }
      const current = parseRows(raw);
      const tombstones = tombRaw ? JSON.parse(tombRaw) : {};
      tombstones.jds ||= {};
      const ids = new Set(body.jds.map((row) => row.id));
      for (const row of current) if (!ids.has(row.id)) tombstones.jds[row.id] = Date.now();
      // 只有用户明确提交的新面板可以重新开放岗位，普通同步不能清除删除标记。
      for (const row of body.jds) delete tombstones.jds[row.id];
      const nextEpoch = randomUUID();
      const committed = await kvTransaction({
        expected: [
          { key: KEY, exists: raw !== null, ...(raw !== null ? { value: raw } : {}) },
          { key: EPOCH, exists: epoch !== null, ...(epoch !== null ? { value: epoch } : {}) },
          { key: TOMBS, exists: tombRaw !== null, ...(tombRaw !== null ? { value: tombRaw } : {}) },
          { key: receipt, exists: false },
        ],
        writes: [
          { key: KEY, value: JSON.stringify(body.jds) },
          { key: EPOCH, value: nextEpoch },
          { key: TOMBS, value: JSON.stringify(tombstones) },
          { key: `recruit:backup:jds:before-${nextEpoch}`, value: raw || '[]', ttlSeconds: 2592000 },
          { key: 'recruit:jds-last-replacement', value: JSON.stringify({ epoch: nextEpoch, count: body.jds.length, previousCount: current.length, at: new Date().toISOString() }) },
          { key: receipt, value: JSON.stringify({ epoch: nextEpoch, payloadHash }), ttlSeconds: 604800 },
        ],
        increments: ['recruit:version'],
      });
      if (committed.ok) return NextResponse.json({ ok: true, epoch: nextEpoch, unchanged: true });
    }
    return NextResponse.json({ error: '岗位正在更新，本次未覆盖，请重试' }, { status: 409 });
  } catch {
    return NextResponse.json({ error: '未能确认云端保存，请重新读取岗位后重试；未显示导入成功' }, { status: 503 });
  }
}
