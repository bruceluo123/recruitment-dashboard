import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { guardApi } from '@/lib/api-guard';
import { apiSessionUser, hasValidServiceToken, requireOwnerSession } from '@/lib/auth-api';
import { kvCommandStrict, kvTransaction } from '@/lib/kv-server';
import type { OwnerId } from '@/lib/auth-core';

export const dynamic = 'force-dynamic';

const PREFIXES: Record<OwnerId, string> = {
  a: 'XYMMF00',
  b: 'XYBB00',
};
const MAX_SEQUENCE = 999_999_999;

interface CodeEntry { identity: string; name: string }
interface CodeState { sequence: number; entries: Record<string, CodeEntry> }

const codeStateKey = (owner: OwnerId): string => `recruit:candidate-code:state:v1:${owner}`;
const legacySequenceKey = (owner: OwnerId): string => `recruit:candidate-code:sequence:${owner}`;

function rows(value: unknown): Array<Record<string, unknown>> {
  if (value == null) return [];
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { throw new Error('candidate source is malformed'); }
  }
  if (!Array.isArray(value)) throw new Error('candidate source is malformed');
  return value.filter((item) => item && typeof item === 'object');
}

function normalizeIdentity(value: unknown): string {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '');
}

function stableIdentity(item: Record<string, unknown>, owner: OwnerId, code: string): string {
  const existing = [item.candidateIdentityId, item.talentId, item.candidateId]
    .find((value) => typeof value === 'string' && value.trim());
  return existing ? String(existing).trim() : `legacy:${owner}:${code}`;
}

async function seedState(owner: OwnerId, prefix: string): Promise<CodeState> {
  const values = await kvCommandStrict<(string | null)[]>('MGET', 'recruit:repush', 'recruit:candidates', 'recruit:talents');
  const pattern = new RegExp(`^${prefix}(\\d{3,9})$`, 'i');
  const identities = new Map<string, { identity: string; name: string }>();
  values.flatMap(rows).forEach((item) => {
    const code = String(item.candidateCode || '').trim().toUpperCase();
    const match = code.match(pattern);
    if (!match || Number.parseInt(match[1], 10) < 1) return;
    const name = normalizeIdentity(item.candidateName || item.name);
    const known = identities.get(code);
    const identity = stableIdentity(item, owner, code);
    const sameExplicitIdentity = known?.identity === identity && !identity.startsWith('legacy:');
    identities.set(code, {
      identity: known?.identity || identity,
      name: known?.name && name && known.name !== name && !sameExplicitIdentity ? '!conflict' : known?.name || name,
    });
  });
  const sequence = Array.from(identities.keys()).reduce((max, code) => {
    const match = code.match(pattern);
    return match ? Math.max(max, Number.parseInt(match[1], 10)) : max;
  }, 0);
  return { sequence, entries: Object.fromEntries(identities) };
}

async function allocateFromAtomicSequence(
  owner: OwnerId,
  prefix: string,
  candidateName: string,
  candidateIdentityId: string,
): Promise<{ code: string; identity: string }> {
  const stateKey = codeStateKey(owner);
  const sequenceKey = legacySequenceKey(owner);
  if (candidateIdentityId) {
    try {
      const raw = await kvCommandStrict<string | null>('GET', stateKey);
      const state = raw ? JSON.parse(raw) as CodeState : null;
      const existing = state?.entries
        ? Object.entries(state.entries).find(([, entry]) => entry.identity === candidateIdentityId && entry.name !== '!conflict')
        : undefined;
      if (existing) return { code: existing[0], identity: candidateIdentityId };
    } catch {
      // 读取不到复用记录时继续走原子序列，不能让短暂读取失败卡住生成。
    }
  }
  const sequence = await kvCommandStrict<number>('INCR', sequenceKey);
  if (!Number.isFinite(sequence) || sequence < 1 || sequence > MAX_SEQUENCE) {
    throw new Error('candidate code sequence exhausted');
  }
  const code = `${prefix}${String(sequence).padStart(3, '0')}`;
  const identity = candidateIdentityId || randomUUID();

  // 原子计数已保证编号唯一；再尽力把身份写回账本，便于同一候选人重试时复用编号。
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const raw = await kvCommandStrict<string | null>('GET', stateKey);
      const state: CodeState = raw ? JSON.parse(raw) as CodeState : { sequence: 0, entries: {} };
      state.sequence = Math.max(Number(state.sequence) || 0, sequence);
      state.entries ||= {};
      state.entries[code] = { identity, name: candidateName };
      const committed = await kvTransaction({
        expected: [{ key: stateKey, exists: Boolean(raw), ...(raw ? { value: raw } : {}) }],
        writes: [{ key: stateKey, value: JSON.stringify(state) }],
      });
      if (committed.ok) break;
    } catch {
      // 编号已经由原子序列安全保留；账本回填失败不应阻断文案生成。
    }
  }
  return { code, identity };
}

export async function POST(request: NextRequest) {
  let body: { owner?: OwnerId; preferredCode?: string; candidateName?: string; candidateIdentityId?: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: '请求格式无效' }, { status: 400 }); }

  const owner = body.owner === 'a' || body.owner === 'b' ? body.owner : null;
  if (!owner) return NextResponse.json({ error: '所属人无效' }, { status: 400 });
  const unauthorized = await requireOwnerSession(request, owner, true);
  if (unauthorized) return unauthorized;
  const actor = (await apiSessionUser(request))?.sub || 'service';
  const blocked = hasValidServiceToken(request) ? null : guardApi(request, `candidate-code:${actor}`, 30, 60_000);
  if (blocked) return blocked;

  const candidateName = normalizeIdentity(body.candidateName);
  if (!candidateName) return NextResponse.json({ error: '请先确认候选人姓名' }, { status: 400 });

  try {
    const prefix = PREFIXES[owner];
    const preferredCode = String(body.preferredCode || '').trim().toUpperCase();
    const candidateIdentityId = String(body.candidateIdentityId || '').trim();
    const preferredMatch = preferredCode.match(new RegExp(`^${prefix}(\\d{3,9})$`, 'i'));
    if (preferredCode.startsWith(prefix) && (!preferredMatch || Number.parseInt(preferredMatch[1], 10) < 1)) {
      return NextResponse.json({ error: '候选人编号超出支持范围，请核对后重试' }, { status: 400 });
    }
    const stateKey = codeStateKey(owner);
    const sequenceKey = legacySequenceKey(owner);
    for (let attempt = 0; attempt < 5; attempt++) {
      const [raw, sequenceRaw] = await kvCommandStrict<(string | null)[]>('MGET', stateKey, sequenceKey);
      const state: CodeState = raw ? JSON.parse(raw) as CodeState : await seedState(owner, prefix);
      state.sequence = Math.max(0, Number(state.sequence) || 0, Number(sequenceRaw) || 0);
      state.entries ||= {};

      let code: string;
      let identity: string;
      let reused = false;
      const existingIdentity = !preferredMatch && candidateIdentityId
        ? Object.entries(state.entries).find(([, entry]) => entry.identity === candidateIdentityId && entry.name !== '!conflict')
        : undefined;
      if (existingIdentity) {
        [code] = existingIdentity;
        identity = candidateIdentityId;
        state.entries[code] = { identity, name: candidateName };
        reused = true;
      } else if (preferredMatch) {
        code = preferredCode;
        const known = state.entries[code];
        const matchesIdentity = Boolean(candidateIdentityId && known?.identity === candidateIdentityId);
        if (known && (known.name === '!conflict'
          || (candidateIdentityId ? !matchesIdentity : known.name !== candidateName))) {
          return NextResponse.json({ error: '该候选人编号已属于其他人，请核对编号或移除后重新生成' }, { status: 409 });
        }
        identity = known?.identity || candidateIdentityId || randomUUID();
        state.entries[code] = { identity, name: candidateName };
        state.sequence = Math.max(state.sequence, Number.parseInt(preferredMatch[1], 10));
        reused = Boolean(known);
      } else {
        do {
          state.sequence += 1;
          if (state.sequence > MAX_SEQUENCE) throw new Error('candidate code sequence exhausted');
          code = `${prefix}${String(state.sequence).padStart(3, '0')}`;
        } while (state.entries[code]);
        identity = candidateIdentityId || randomUUID();
        state.entries[code] = { identity, name: candidateName };
      }

      const committed = await kvTransaction({
        expected: [
          { key: stateKey, exists: Boolean(raw), ...(raw ? { value: raw } : {}) },
          { key: sequenceKey, exists: Boolean(sequenceRaw), ...(sequenceRaw ? { value: sequenceRaw } : {}) },
        ],
        writes: [
          { key: stateKey, value: JSON.stringify(state) },
          { key: sequenceKey, value: String(state.sequence) },
        ],
      });
      if (committed.ok) {
        return NextResponse.json({ ok: true, code, candidateIdentityId: identity, reused }, { headers: { 'Cache-Control': 'no-store' } });
      }
    }
    if (!preferredMatch) {
      const fallback = await allocateFromAtomicSequence(owner, prefix, candidateName, candidateIdentityId);
      return NextResponse.json({
        ok: true,
        code: fallback.code,
        candidateIdentityId: fallback.identity,
        reused: false,
      }, { headers: { 'Cache-Control': 'no-store' } });
    }
    return NextResponse.json({ error: '候选人编号分配遇到并发，请重试' }, { status: 409 });
  } catch (error) {
    const prefix = PREFIXES[owner];
    const preferredCode = String(body.preferredCode || '').trim().toUpperCase();
    if (!preferredCode) {
      try {
        const fallback = await allocateFromAtomicSequence(
          owner,
          prefix,
          candidateName,
          String(body.candidateIdentityId || '').trim(),
        );
        return NextResponse.json({
          ok: true,
          code: fallback.code,
          candidateIdentityId: fallback.identity,
          reused: false,
        }, { headers: { 'Cache-Control': 'no-store' } });
      } catch {
        // 继续返回统一错误，避免泄露存储细节。
      }
    }
    console.error('candidate code allocation failed', error);
    return NextResponse.json({ error: '候选人编号分配失败，请重试' }, { status: 503 });
  }
}
