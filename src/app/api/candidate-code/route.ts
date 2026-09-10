import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { guardApi } from '@/lib/api-guard';
import { hasValidServiceToken, requireOwnerSession } from '@/lib/auth-api';
import { kvCommandStrict } from '@/lib/kv-server';
import type { OwnerId } from '@/lib/auth-core';

export const dynamic = 'force-dynamic';

const PREFIXES: Record<OwnerId, string> = {
  a: 'XYMMF00',
  b: 'XYBB00',
};
const MAX_SEQUENCE = 999_999_999;

const ALLOCATE = `
local code
repeat
  local value = redis.call('INCR', KEYS[1])
  if value > tonumber(ARGV[4]) then return redis.error_reply('candidate code sequence exhausted') end
  local suffix = tostring(value)
  while string.len(suffix) < 3 do suffix = '0' .. suffix end
  code = ARGV[1] .. suffix
until redis.call('SADD', KEYS[2], code) == 1
redis.call('HSET', KEYS[3], code, ARGV[2])
redis.call('HSET', KEYS[4], code, ARGV[3])
return {code, ARGV[2]}`;

const RESERVE = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local requested = tonumber(ARGV[2]) or 0
local requestedIdentity = ARGV[3]
local candidateName = ARGV[4]
local fallbackIdentity = ARGV[5]
local used = redis.call('SISMEMBER', KEYS[2], ARGV[1])
local knownIdentity = redis.call('HGET', KEYS[3], ARGV[1])
local knownName = redis.call('HGET', KEYS[4], ARGV[1])

if knownIdentity == '!conflict' or knownName == '!conflict' then return {0, ARGV[1], ''} end

if used == 1 then
  if knownName then
    if requestedIdentity ~= '' then
      if knownIdentity and knownIdentity ~= requestedIdentity then return {0, ARGV[1], ''} end
      if not knownIdentity and knownName ~= candidateName then return {0, ARGV[1], ''} end
      knownIdentity = requestedIdentity
      redis.call('HSET', KEYS[3], ARGV[1], knownIdentity)
      redis.call('HSET', KEYS[4], ARGV[1], candidateName)
      return {1, ARGV[1], knownIdentity}
    end
    if candidateName == '' or knownName ~= candidateName or not knownIdentity then return {0, ARGV[1], ''} end
    return {1, ARGV[1], knownIdentity}
  end

  if knownIdentity then
    if knownIdentity == candidateName and candidateName ~= '' then
      local migratedIdentity = requestedIdentity ~= '' and requestedIdentity or fallbackIdentity
      redis.call('HSET', KEYS[3], ARGV[1], migratedIdentity)
      redis.call('HSET', KEYS[4], ARGV[1], candidateName)
      return {1, ARGV[1], migratedIdentity}
    end
    if requestedIdentity == '' or knownIdentity ~= requestedIdentity then return {0, ARGV[1], ''} end
    redis.call('HSET', KEYS[4], ARGV[1], candidateName)
    return {1, ARGV[1], knownIdentity}
  end

  local recoveredIdentity = requestedIdentity ~= '' and requestedIdentity or fallbackIdentity
  redis.call('HSET', KEYS[3], ARGV[1], recoveredIdentity)
  redis.call('HSET', KEYS[4], ARGV[1], candidateName)
  return {1, ARGV[1], recoveredIdentity}
end

local identity = requestedIdentity ~= '' and requestedIdentity or fallbackIdentity
if requested > current then redis.call('SET', KEYS[1], requested) end
redis.call('SADD', KEYS[2], ARGV[1])
redis.call('HSET', KEYS[3], ARGV[1], identity)
redis.call('HSET', KEYS[4], ARGV[1], candidateName)
return {1, ARGV[1], identity}`;

const SEED = `
if redis.call('EXISTS', KEYS[5]) == 1 then return 0 end
local maximum = tonumber(ARGV[1]) or 0
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
if maximum > current then redis.call('SET', KEYS[1], maximum) end
for _, entry in ipairs(cjson.decode(ARGV[2])) do
  local code = entry[1]
  local identity = entry[2]
  local candidateName = entry[3]
  local knownIdentity = redis.call('HGET', KEYS[3], code)
  local knownName = redis.call('HGET', KEYS[4], code)
  redis.call('SADD', KEYS[2], code)

  if candidateName == '!conflict' or knownIdentity == '!conflict' or knownName == '!conflict' then
    if not knownIdentity then redis.call('HSET', KEYS[3], code, identity) end
    redis.call('HSET', KEYS[4], code, '!conflict')
  elseif knownName then
    if candidateName ~= '' and knownName ~= candidateName then
      redis.call('HSET', KEYS[4], code, '!conflict')
    elseif not knownIdentity then
      redis.call('HSET', KEYS[3], code, identity)
    end
  else
    if not knownIdentity then
      redis.call('HSET', KEYS[3], code, identity)
    elseif knownIdentity == candidateName and candidateName ~= '' then
      redis.call('HSET', KEYS[3], code, identity)
    end
    if candidateName ~= '' then redis.call('HSET', KEYS[4], code, candidateName) end
  end
end
redis.call('SET', KEYS[5], '1')
return 1`;

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

async function seedCounter(owner: OwnerId, prefix: string): Promise<void> {
  const counterKey = `recruit:candidate-code:sequence:${owner}`;
  const seededKey = `recruit:candidate-code:seeded:v3:${owner}`;
  if (await kvCommandStrict<number>('EXISTS', seededKey)) return;
  const values = await Promise.all([
    kvCommandStrict<unknown>('GET', 'recruit:repush'),
    kvCommandStrict<unknown>('GET', 'recruit:candidates'),
    kvCommandStrict<unknown>('GET', 'recruit:talents'),
  ]);
  const pattern = new RegExp(`^${prefix}(\\d{3,9})$`, 'i');
  const identities = new Map<string, { identity: string; name: string }>();
  values.flatMap(rows).forEach((item) => {
    const code = String(item.candidateCode || '').trim().toUpperCase();
    const match = code.match(pattern);
    if (!match || Number.parseInt(match[1], 10) < 1) return;
    const name = normalizeIdentity(item.candidateName || item.name);
    const known = identities.get(code);
    identities.set(code, {
      identity: known?.identity || stableIdentity(item, owner, code),
      name: known?.name && name && known.name !== name ? '!conflict' : known?.name || name,
    });
  });
  const codes = Array.from(identities.keys());
  const maximum = codes.reduce((max, code) => {
    const match = code.match(pattern);
    return match ? Math.max(max, Number.parseInt(match[1], 10)) : max;
  }, 0);
  await kvCommandStrict<number>('EVAL', SEED, 5,
    counterKey,
    `recruit:candidate-code:used:${owner}`,
    `recruit:candidate-code:identities:${owner}`,
    `recruit:candidate-code:identity-names:${owner}`,
    seededKey,
    String(maximum),
    JSON.stringify(codes.map((code) => {
      const identity = identities.get(code)!;
      return [code, identity.identity, identity.name];
    })));
}

export async function POST(request: NextRequest) {
  let body: { owner?: OwnerId; preferredCode?: string; candidateName?: string; candidateIdentityId?: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: '请求格式无效' }, { status: 400 }); }

  const owner = body.owner === 'a' || body.owner === 'b' ? body.owner : null;
  if (!owner) return NextResponse.json({ error: '所属人无效' }, { status: 400 });
  const unauthorized = await requireOwnerSession(request, owner, true);
  if (unauthorized) return unauthorized;
  const blocked = hasValidServiceToken(request) ? null : guardApi(request, 'candidate-code', 30, 60_000);
  if (blocked) return blocked;

  const candidateName = normalizeIdentity(body.candidateName);
  if (!candidateName) return NextResponse.json({ error: '请先确认候选人姓名' }, { status: 400 });

  try {
    const prefix = PREFIXES[owner];
    const counterKey = `recruit:candidate-code:sequence:${owner}`;
    const usedKey = `recruit:candidate-code:used:${owner}`;
    const identitiesKey = `recruit:candidate-code:identities:${owner}`;
    const identityNamesKey = `recruit:candidate-code:identity-names:${owner}`;
    await seedCounter(owner, prefix);

    const preferredCode = String(body.preferredCode || '').trim().toUpperCase();
    const candidateIdentityId = String(body.candidateIdentityId || '').trim();
    const preferredMatch = preferredCode.match(new RegExp(`^${prefix}(\\d{3,9})$`, 'i'));
    if (preferredCode.startsWith(prefix) && (!preferredMatch || Number.parseInt(preferredMatch[1], 10) < 1)) {
      return NextResponse.json({ error: '候选人编号超出支持范围，请核对后重试' }, { status: 400 });
    }
    if (preferredMatch) {
      const [reserved, code, identity] = await kvCommandStrict<[number, string, string]>('EVAL', RESERVE, 4,
        counterKey,
        usedKey,
        identitiesKey,
        identityNamesKey,
        preferredCode,
        preferredMatch[1],
        candidateIdentityId,
        candidateName,
        randomUUID());
      if (Number(reserved) !== 1 || !identity) {
        return NextResponse.json({ error: '该候选人编号已属于其他人，请核对编号或移除后重新生成' }, { status: 409 });
      }
      return NextResponse.json({ ok: true, code, candidateIdentityId: identity, reused: true }, { headers: { 'Cache-Control': 'no-store' } });
    }

    const identity = candidateIdentityId || randomUUID();
    const [code, allocatedIdentity] = await kvCommandStrict<[string, string]>('EVAL', ALLOCATE, 4,
      counterKey,
      usedKey,
      identitiesKey,
      identityNamesKey,
      prefix,
      identity,
      candidateName,
      String(MAX_SEQUENCE));
    return NextResponse.json({ ok: true, code, candidateIdentityId: allocatedIdentity, reused: false }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: '候选人编号分配失败，请重试' }, { status: 503 });
  }
}
