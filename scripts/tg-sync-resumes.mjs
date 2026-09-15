#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { put } from '@vercel/blob';

const ROOT = process.cwd();
const CODE_PREFIXES = {
  a: 'XYMMF00',
  b: 'XYBB00',
};
const IMPORT_COMMIT_SCRIPT = `
local snapshotCount = tonumber(ARGV[1])
local candidateEntries = cjson.decode(ARGV[2 + snapshotCount * 2])
local versionKey = KEYS[snapshotCount + 1]
local usedKey = KEYS[snapshotCount + 2]
local sequenceKey = KEYS[snapshotCount + 3]
local identitiesKey = KEYS[snapshotCount + 4]
local identityNamesKey = KEYS[snapshotCount + 5]

local function keyType(key)
  local result = redis.call('TYPE', key)
  if type(result) == 'table' then return result.ok end
  return result
end

local usedType = keyType(usedKey)
if usedType ~= 'none' and usedType ~= 'set' then
  return redis.error_reply('candidate code used key has invalid type')
end
local identitiesType = keyType(identitiesKey)
if identitiesType ~= 'none' and identitiesType ~= 'hash' then
  return redis.error_reply('candidate code identities key has invalid type')
end
local identityNamesType = keyType(identityNamesKey)
if identityNamesType ~= 'none' and identityNamesType ~= 'hash' then
  return redis.error_reply('candidate code identity names key has invalid type')
end
local sequenceRaw = redis.call('GET', sequenceKey)
if sequenceRaw and not string.match(sequenceRaw, '^%d+$') then
  return redis.error_reply('candidate code sequence is invalid')
end
local sequence = tonumber(sequenceRaw or '0')
if not sequence then return redis.error_reply('candidate code sequence is invalid') end
local versionRaw = redis.call('GET', versionKey)
if versionRaw and not string.match(versionRaw, '^%d+$') then return redis.error_reply('version is invalid') end

local identityUpdates = {}
local identityNameUpdates = {}
local identityConflicts = {}
local maximum = sequence
for _, entry in ipairs(candidateEntries) do
  local code = tostring(entry[1] or '')
  local suffix = tonumber(entry[2]) or 0
  local candidateIdentityId = tostring(entry[3] or '')
  local identityName = tostring(entry[4] or '')
  local allowRepair = tostring(entry[5] or '') == '1'
  if suffix < 1 or suffix > 999999999 then return redis.error_reply('candidate code suffix is out of range') end
  if suffix > maximum then maximum = suffix end
  local used = redis.call('SISMEMBER', usedKey, code)
  local knownTalentId = redis.call('HGET', identitiesKey, code)
  local knownName = redis.call('HGET', identityNamesKey, code)
  -- Before this registry existed, identities stored normalized names.  A matching
  -- legacy value can be promoted to the stable talent id in this same CAS.
  local legacyName = knownTalentId and knownTalentId == identityName
  local identityMismatch = knownTalentId and not legacyName and knownTalentId ~= candidateIdentityId
  local nameMismatch = knownName and knownName ~= identityName
  local duplicateMismatch = (identityUpdates[code] and identityUpdates[code] ~= candidateIdentityId)
    or (identityNameUpdates[code] and identityNameUpdates[code] ~= identityName)
  local invalidIdentity = candidateIdentityId == ''
    or identityName == ''
    or candidateIdentityId == '!conflict'
    or identityName == '!conflict'
    or duplicateMismatch
  local registeredMismatch = knownTalentId == '!conflict'
    or knownName == '!conflict'
    or identityMismatch
    or nameMismatch
    or (used == 1 and not knownTalentId)
  if invalidIdentity or (registeredMismatch and not allowRepair) then
    table.insert(identityConflicts, code)
  else
    identityUpdates[code] = candidateIdentityId
    identityNameUpdates[code] = identityName
  end
end

for index = 1, snapshotCount do
  local expectedHash = ARGV[1 + index]
  local current = redis.call('GET', KEYS[index]) or ''
  if redis.sha1hex(current) ~= expectedHash then return {0, index} end
end
if #identityConflicts > 0 then
  return {-1, identityConflicts[1]}
end
for index = 1, snapshotCount do
  redis.call('SET', KEYS[index], ARGV[1 + snapshotCount + index])
end
for _, entry in ipairs(candidateEntries) do
  local code = tostring(entry[1] or '')
  redis.call('SADD', usedKey, code)
  if identityUpdates[code] then
    redis.call('HSET', identitiesKey, code, identityUpdates[code])
    redis.call('HSET', identityNamesKey, code, identityNameUpdates[code])
  end
end
if maximum > sequence then redis.call('SET', sequenceKey, tostring(maximum)) end
local version = redis.call('INCR', versionKey)
return {1, version}
`;
const EMPTY_RUN_COMMIT_SCRIPT = `
if (redis.call('GET', KEYS[1]) or '') ~= ARGV[1] then return {0, 1} end
if (redis.call('GET', KEYS[2]) or '') ~= ARGV[3] then return {0, 2} end
redis.call('SET', KEYS[1], ARGV[2])
return {1, 0}
`;

function loadEnv() {
  for (const fileName of ['.env.local', '.env.supabase.local']) {
    const envPath = path.join(ROOT, fileName);
    if (!fs.existsSync(envPath)) continue;
    const raw = fs.readFileSync(envPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([^#][^=]+)=\s*(.*)\s*$/);
      if (!m) continue;
      const key = m[1].trim();
      let value = m[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      if (!process.env[key]) process.env[key] = value;
    }
  }
}

function arg(name, fallback = '') {
  const idx = process.argv.indexOf(name);
  return idx !== -1 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeIdentity(value) {
  return String(value || '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '');
}

function snapshotString(value, key) {
  if (value == null) return '';
  if (typeof value !== 'string') throw new Error(`KV ${key} is not a string snapshot`);
  return value;
}

function parseArraySnapshot(raw, key) {
  if (!raw) return [];
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`KV ${key} contains invalid JSON`);
  }
  if (!Array.isArray(value)) throw new Error(`KV ${key} must contain an array`);
  return value;
}

function parseObjectSnapshot(raw, key) {
  if (!raw) return {};
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`KV ${key} contains invalid JSON`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`KV ${key} must contain an object`);
  }
  return value;
}

function candidateSequenceSuffix(code, account) {
  const match = String(code || '').toUpperCase().match(new RegExp(`^${CODE_PREFIXES[account]}(\\d{3,9})$`));
  if (!match) throw new Error(`Candidate code format is out of range: ${code}`);
  const suffix = Number.parseInt(match[1], 10);
  if (!Number.isSafeInteger(suffix) || suffix < 1 || suffix > 999_999_999) {
    throw new Error(`Candidate code suffix is out of range: ${code}`);
  }
  return String(suffix);
}

function recordImportedIdentity(identities, code, candidateIdentityId, name, allowRepair = false) {
  const normalizedCode = String(code || '').trim().toUpperCase();
  const identityName = normalizeIdentity(name);
  const known = identities.get(normalizedCode) || '';
  const next = { candidateIdentityId: String(candidateIdentityId || ''), name: identityName, allowRepair };
  if (!known) {
    identities.set(normalizedCode, next);
    return;
  }
  if (known === '!conflict' || known.candidateIdentityId !== next.candidateIdentityId || known.name !== next.name) {
    identities.set(normalizedCode, '!conflict');
  } else if (allowRepair && !known.allowRepair) {
    identities.set(normalizedCode, { ...known, allowRepair: true });
  }
}

function shanghaiDayStart(day) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) return new Date(`${day}T00:00:00+08:00`);
  const exact = new Date(day);
  if (Number.isNaN(exact.getTime())) throw new Error(`Invalid --from/--to time: ${day}`);
  return exact;
}

function shanghaiTodayKey() {
  const d = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function parseProxy(raw) {
  if (!raw) return undefined;
  const match = raw.match(/^(?:(socks5|socks4):\/\/)?([^:]+):(\d+)$/i);
  if (!match) throw new Error('TG_PROXY format should be host:port or socks5://host:port');
  return {
    ip: match[2],
    port: parseInt(match[3], 10),
    socksType: match[1]?.toLowerCase() === 'socks4' ? 4 : 5,
    timeout: 10,
  };
}

function safeFileName(fileName) {
  return clean(fileName).replace(/[^\w.\u4e00-\u9fa5-]/g, '_') || 'resume.pdf';
}

function label(text, labels) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  for (const line of lines) {
    for (const item of labels) {
      const idx = line.indexOf(item);
      if (idx === -1) continue;
      if (item === '\u5c97\u4f4d' && line.includes('\u5c97\u4f4d\u7c7b\u578b')) continue;
      const rest = clean(line.slice(idx + item.length).replace(/^[\s:\uFF1A-]+/, ''));
      if (rest) return rest;
    }
  }
  return '';
}

function cleanName(value) {
  return clean(value)
    .replace(/^\uFF08[^\uFF09]*\uFF09[:\uFF1A]?\s*/, '')
    .replace(/^\([^)]*\):?\s*/, '')
    .replace(/^[:\uFF1A]+\s*/, '');
}

function codeFromText(text) {
  const m = String(text || '').match(/\bXY(?:MMF|BB)\d+\b/i);
  return m ? m[0].toUpperCase() : '';
}

function isTargetCode(code) {
  return /^XY(?:MMF|BB)\d+$/i.test(code);
}

function isAccountCode(code, account) {
  return account === 'b' ? /^XYBB\d+$/i.test(code) : /^XYMMF\d+$/i.test(code);
}

function parseRecommendation(text, fallbackCode = '') {
  const S = {
    candidateCode: '\u5019\u9009\u4eba\u7f16\u7801',
    candidateName: '\u5019\u9009\u4eba\u59d3\u540d',
    resumeName: '\u7b80\u5386\u540d',
    name: '\u59d3\u540d',
    applyJob: '\u5e94\u8058\u5c97\u4f4d',
    recJob: '\u63a8\u8350\u5c97\u4f4d',
    position: '\u804c\u4f4d',
    job: '\u5c97\u4f4d',
    orgFull: '\u63a8\u8350\u7f16\u5236\u7ec4\u7ec7/\u5e8f\u5217/\u670d\u52a1\u5355\u4f4d',
    inOrg: '\u5165\u804c\u7f16\u5236\u7ec4\u7ec7',
    recOrg: '\u63a8\u8350\u7f16\u5236\u7ec4\u7ec7',
    service: '\u670d\u52a1\u5355\u4f4d',
    source: '\u7b80\u5386\u6765\u6e90',
    channel: '\u62db\u8058\u6e20\u9053',
    recPerson: '\u7b80\u5386\u63a8\u8350\u4eba',
    recommender: '\u63a8\u8350\u4eba',
    bp: '\u7b80\u5386\u5bf9\u63a5BP',
    dock: '\u7b80\u5386\u5bf9\u63a5\u4eba',
    dockBp: '\u5bf9\u63a5BP',
    contact: '\u5019\u9009\u4eba\u8054\u7cfb\u65b9\u5f0f',
    contact2: '\u8054\u7cfb\u65b9\u5f0f',
  };
  return {
    code: (label(text, [S.candidateCode, '\u7f16\u53f7', '\u7f16\u7801']) || fallbackCode).toUpperCase(),
    name: cleanName(label(text, [S.candidateName, S.resumeName, S.name])),
    jobTitle: clean(label(text, [S.applyJob, S.recJob, S.position, S.job])),
    organization: clean(label(text, [S.orgFull, S.inOrg, S.recOrg, S.service])),
    source: clean(label(text, [S.source])),
    channel: clean(label(text, [S.channel])),
    recommender: clean(label(text, [S.recPerson, S.recommender])),
    contactPerson: clean(label(text, [S.bp, S.dock, S.dockBp])),
    contact: clean(label(text, [S.contact, S.contact2])),
  };
}

function splitOrgDept(value) {
  const text = clean(value);
  if (!text) return {};
  const parts = text.split(/[\s·/]+/).filter(Boolean);
  if (parts.length >= 2) return { organization: parts[0], department: parts.slice(1).join(' ') };
  return { organization: text };
}

function categories(title, rawText) {
  const s = `${title} ${rawText}`.toLowerCase();
  const out = [];
  const add = (x) => { if (!out.includes(x)) out.push(x); };
  if (/ai|aigc|agent|llm|\u4eba\u5de5\u667a\u80fd/.test(s)) add('ai');
  if (/\u6d4b\u8bd5|test|qa/.test(s)) add('testing');
  if (/\u524d\u7aef|flutter|android|\u5b89\u5353|\u79fb\u52a8\u7aef|react|vue/.test(s)) add('frontend');
  if (/go|golang|php|java|\u540e\u7aef|\u5168\u6808/.test(s)) add('backend');
  if (/\u4ea7\u54c1|pm|product/.test(s)) add('product');
  if (/\u8fd0\u8425/.test(s)) add('operations');
  if (/\u54c1\u724c|\u7b56\u5212|\u5e02\u573a|marketing/.test(s)) add('marketing');
  if (/\u5185\u5bb9|\u77ed\u89c6\u9891|\u89c6\u9891|\u526a\u8f91/.test(s)) add('content');
  return out.length ? out : ['operations'];
}

function genId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function mimeType(fileName) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (lower.endsWith('.doc')) return 'application/msword';
  return 'application/octet-stream';
}

function fileNameOf(msg) {
  const attrs = msg.document?.attributes || [];
  for (const attr of attrs) {
    if (attr instanceof Api.DocumentAttributeFilename || attr.className === 'DocumentAttributeFilename') return attr.fileName;
  }
  return msg.file?.name || '';
}

function isResumeFile(fileName) {
  return /\.(pdf|docx?)$/i.test(fileName) && !/(\u4f5c\u54c1\u96c6|portfolio|showcase)/i.test(fileName);
}

function shouldScanGroupTitle(title) {
  return title.includes('\u62db\u8058')
    || title.includes('\u5bfb\u82f1')
    || title.includes('\u4eba\u624d\u5f15\u8fdb')
    || (title.includes('\u7b80\u5386') && title.includes('\u5bf9\u63a5'));
}

function shouldScanPrivateDialog(dialog) {
  const entity = dialog.entity;
  const isPrivate = Boolean(dialog.isUser || entity?.className === 'User');
  if (!isPrivate) return false;
  const username = clean(entity?.username).replace(/^@/, '').toLowerCase();
  const title = clean(dialog.title || dialog.name).replace(/^@/, '').toLowerCase();
  return username === 'ojisamer' || title === 'ojisamer';
}

function localDateKey(iso) {
  const d = new Date(new Date(iso).getTime() + 8 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

async function kvGet(key) {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const values = await supabaseReadRaw([key]);
    return values[key] ?? null;
  }
  const res = await fetch(`${process.env.KV_REST_API_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
  });
  if (!res.ok) throw new Error(`KV get ${key} failed: ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(`KV get ${key} failed: ${data.error}`);
  return data.result;
}

async function kvHGet(key, field) {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const account = key.endsWith(':b') ? 'b' : 'a';
    const stateRaw = await kvGet(`recruit:candidate-code:state:v1:${account}`);
    const state = stateRaw ? JSON.parse(stateRaw) : { entries: {} };
    const entry = state.entries?.[field];
    return key.includes('identity-names') ? entry?.name ?? null : entry?.identity ?? null;
  }
  const res = await fetch(`${process.env.KV_REST_API_URL}/hget/${encodeURIComponent(key)}/${encodeURIComponent(field)}`, {
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
  });
  if (!res.ok) throw new Error(`KV hget ${key} failed: ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(`KV hget ${key} failed: ${data.error}`);
  return data.result;
}

async function kvEval(script, keys, args) {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    if (script === EMPTY_RUN_COMMIT_SCRIPT) {
      const committed = await supabaseTx({
        expected: [
          { key: keys[0], exists: Boolean(args[0]), ...(args[0] ? { value: args[0] } : {}) },
          { key: keys[1], exists: Boolean(args[2]), ...(args[2] ? { value: args[2] } : {}) },
        ],
        writes: [{ key: keys[0], value: args[1] }],
      });
      return committed.ok ? [1, 0] : [0, 1];
    }
    if (script === IMPORT_COMMIT_SCRIPT) return supabaseImportCommit(keys, args);
    throw new Error('Unsupported Supabase resume-sync transaction');
  }
  const res = await fetch(process.env.KV_REST_API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(['EVAL', script, keys.length, ...keys, ...args]),
  });
  if (!res.ok) throw new Error(`KV transaction failed: ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(`KV transaction failed: ${data.error}`);
  return data.result;
}

async function supabaseReadRaw(keys) {
  const base = process.env.SUPABASE_URL.replace(/\/$/, '');
  const token = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const response = await fetch(`${base}/rest/v1/rpc/recruit_kv_read`, {
    method: 'POST', headers: { apikey: token, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_keys: keys }),
  });
  if (!response.ok) throw new Error(`Supabase read failed: ${response.status}`);
  return response.json();
}

async function supabaseTx(payload) {
  const base = process.env.SUPABASE_URL.replace(/\/$/, '');
  const token = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const response = await fetch(`${base}/rest/v1/rpc/recruit_kv_tx`, {
    method: 'POST', headers: { apikey: token, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_payload: payload }),
  });
  if (!response.ok) throw new Error(`Supabase transaction failed: ${response.status}`);
  return response.json();
}

async function supabaseImportCommit(keys, args) {
  const count = Number(args[0]);
  const snapshotKeys = keys.slice(0, count);
  const versionKey = keys[count];
  const sequenceKey = keys[count + 2];
  const account = keys[count + 3].endsWith(':b') ? 'b' : 'a';
  const stateKey = `recruit:candidate-code:state:v1:${account}`;
  const current = await supabaseReadRaw([...snapshotKeys, stateKey, sequenceKey]);
  for (let index = 0; index < count; index += 1) {
    const raw = current[snapshotKeys[index]] || '';
    if (createHash('sha1').update(raw).digest('hex') !== args[1 + index]) return [0, index + 1];
  }
  const stateRaw = current[stateKey] || '';
  const state = stateRaw ? JSON.parse(stateRaw) : { sequence: 0, entries: {} };
  state.entries ||= {};
  state.sequence = Math.max(0, Number(state.sequence) || 0, Number(current[sequenceKey]) || 0);
  const candidateEntries = JSON.parse(args[1 + count * 2] || '[]');
  for (const [code, suffixRaw, identity, name, allowRepairRaw] of candidateEntries) {
    const suffix = Number(suffixRaw);
    const known = state.entries[code];
    const allowRepair = String(allowRepairRaw || '') === '1';
    if (!identity || !name || identity === '!conflict' || name === '!conflict'
      || (known && (known.identity !== identity || known.name !== name) && !allowRepair)) return [-1, code];
    state.entries[code] = { identity, name };
    state.sequence = Math.max(state.sequence, suffix);
  }
  const committed = await supabaseTx({
    expected: [
      ...snapshotKeys.map((key) => ({ key, exists: Boolean(current[key]), ...(current[key] ? { value: current[key] } : {}) })),
      { key: stateKey, exists: Boolean(stateRaw), ...(stateRaw ? { value: stateRaw } : {}) },
      { key: sequenceKey, exists: Boolean(current[sequenceKey]), ...(current[sequenceKey] ? { value: current[sequenceKey] } : {}) },
    ],
    writes: [
      ...snapshotKeys.map((key, index) => ({ key, value: args[1 + count + index] })),
      { key: stateKey, value: JSON.stringify(state) },
      { key: sequenceKey, value: String(state.sequence) },
    ],
    increments: [versionKey],
  });
  return committed.ok ? [1, Number(committed.increments?.[versionKey] || 0)] : [0, 1];
}

async function parseResumeFromBlob(url, fileName) {
  const appUrl = (process.env.RECRUIT_APP_URL || 'https://qieqiuzhidao.vercel.app').replace(/\/$/, '');
  const serviceToken = process.env.RECRUIT_SERVICE_TOKEN || process.env.SERVICE_API_TOKEN || '';
  if (!serviceToken) throw new Error('RECRUIT_SERVICE_TOKEN is required for resume parsing');
  const res = await fetch(`${appUrl}/api/resume/parse`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${serviceToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, fileName }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error || `parse failed: ${res.status}`);
  return { text: data.text || '', source: data.source || '' };
}

async function uploadResume(buffer, fileName) {
  const safe = safeFileName(fileName);
  const pathname = `resumes/tg/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safe}`;
  const blob = await put(pathname, buffer, {
    access: 'public',
    contentType: mimeType(fileName),
  });
  return { url: blob.downloadUrl || blob.url, blobUrl: blob.url };
}

function findNearbyCodeMessage(messages, msg) {
  const msgDate = msg.date * 1000;
  const candidates = messages
    .filter((item) => item.id !== msg.id && codeFromText(item.message || ''))
    .map((item) => ({ item, distance: Math.abs(item.date * 1000 - msgDate) }))
    .filter((x) => x.distance <= 10 * 60 * 1000)
    .sort((a, b) => a.distance - b.distance);
  for (const candidate of candidates) {
    const lowerId = Math.min(Number(candidate.item.id), Number(msg.id));
    const upperId = Math.max(Number(candidate.item.id), Number(msg.id));
    // A detached resume used for duplicate checking must not inherit the code
    // from an earlier recommendation when another chat message sits between them.
    const hasInterveningMessage = messages.some((item) => {
      const id = Number(item.id);
      return id > lowerId && id < upperId;
    });
    if (!hasInterveningMessage) return candidate.item;
  }
  return null;
}

async function collectTargets(client, from, to, limit, account) {
  const requestedDialog = clean(arg('--dialog', '')).replace(/^@/, '').toLowerCase();
  const dialogs = await client.getDialogs({ limit: parseInt(arg('--dialog-limit', '500'), 10) });
  const groups = dialogs
    .filter((d) => {
      const title = String(d.title || d.name || '');
      if (requestedDialog) {
        const username = clean(d.entity?.username).replace(/^@/, '').toLowerCase();
        const normalizedTitle = clean(d.title || d.name).replace(/^@/, '').toLowerCase();
        return username === requestedDialog || normalizedTitle === requestedDialog;
      }
      return shouldScanGroupTitle(title) || shouldScanPrivateDialog(d);
    })
    .map((d) => ({ id: String(d.id || ''), title: String(d.title || d.name || d.id || ''), entity: d.entity }));

  const targets = [];
  for (const group of groups) {
    const messages = await client.getMessages(group.entity, { limit });
    for (const msg of messages) {
      const date = new Date(msg.date * 1000);
      if (date < from || date >= to) continue;
      const fileName = fileNameOf(msg);
      if (!isResumeFile(fileName)) continue;
      const directCode = codeFromText(msg.message || '');
      const nearby = directCode ? null : findNearbyCodeMessage(messages, msg);
      const code = directCode || codeFromText(nearby?.message || '');
      if (!isTargetCode(code) || !isAccountCode(code, account)) continue;
      const recommendationText = clean(msg.message || '') ? msg.message : nearby?.message || '';
      const parsed = parseRecommendation(recommendationText, code);
      if (!isTargetCode(parsed.code)) continue;
      targets.push({
        key: `${group.id}:${msg.id}:${parsed.code}`,
        chatId: group.id,
        chatTitle: group.title,
        messageId: msg.id,
        recommendationMessageId: nearby?.id || msg.id,
        date: date.toISOString(),
        fileName,
        code: parsed.code,
        recommendationText,
        parsed,
        msg,
      });
    }
  }
  return targets.sort((a, b) => a.date.localeCompare(b.date));
}

function findExistingRecommendation(repush, code, jobTitle, dateIso) {
  const day = localDateKey(dateIso);
  return repush.find((item) => {
    if (String(item.candidateCode || '').toUpperCase() !== code) return false;
    if (jobTitle && item.jdTitle && clean(item.jdTitle) !== clean(jobTitle)) return false;
    return localDateKey(item.uploadedAt || '') === day;
  });
}

async function main() {
  loadEnv();
  const account = arg('--account', process.env.TG_ACCOUNT || 'a') === 'b' ? 'b' : 'a';
  const stateKey = account === 'b' ? 'recruit:tg-resume-sync-state-b' : 'recruit:tg-resume-sync-state';
  const ledgerKey = account === 'b' ? 'recruit:tg-resume-sync-ledger-b' : 'recruit:tg-resume-sync-ledger';
  const apiId = process.env[account === 'b' ? 'TG_BB_API_ID' : 'TG_API_ID'] || '';
  const apiHash = process.env[account === 'b' ? 'TG_BB_API_HASH' : 'TG_API_HASH'] || '';
  const session = process.env[account === 'b' ? 'TG_BB_SESSION' : 'TG_SESSION'] || '';
  const dryRun = hasFlag('--dry-run');
  const write = hasFlag('--write');
  const limit = parseInt(arg('--limit', process.env.TG_SYNC_LIMIT || '180'), 10);
  const stateRaw = snapshotString(await kvGet(stateKey), stateKey);
  const state = parseObjectSnapshot(stateRaw, stateKey);
  const fromArg = arg('--from', '');
  const toArg = arg('--to', '');
  const todayStart = shanghaiDayStart(shanghaiTodayKey());
  const stateStart = state.lastScanAt ? addMinutes(new Date(state.lastScanAt), -120) : todayStart;
  const from = fromArg
    ? shanghaiDayStart(fromArg)
    : stateStart < todayStart
      ? todayStart
      : stateStart;
  const to = toArg ? shanghaiDayStart(toArg) : new Date(Date.now() + 60 * 1000);

  if (!dryRun && !write) throw new Error('Pass --dry-run to preview or --write to sync.');
  if (!apiId || !apiHash || !session) throw new Error(`Missing TG API env for account ${account}.`);
  if (!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
    && !(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN)) throw new Error('Missing business storage env.');
  if (write && !process.env.BLOB_READ_WRITE_TOKEN) throw new Error('Missing BLOB_READ_WRITE_TOKEN.');

  const proxy = parseProxy(process.env.TG_PROXY);
  const client = new TelegramClient(
    new StringSession(session.replace(/\s+/g, '')),
    parseInt(apiId, 10),
    apiHash,
    { connectionRetries: 3, ...(proxy ? { proxy } : {}) },
  );
  await client.connect();
  let targets = [];
  try {
    targets = await collectTargets(client, from, to, limit, account);
  } finally {
    if (dryRun) await client.disconnect();
  }

  const ledgerRaw = snapshotString(await kvGet(ledgerKey), ledgerKey);
  const ledger = parseArraySnapshot(ledgerRaw, ledgerKey);
  // 文件已入库但正文解析失败时不能永久跳过；后续网络恢复后自动重试并补齐全文索引。
  const doneKeys = new Set(ledger.filter((row) => row.parsed !== false).map((row) => row.key));
  const pending = targets.filter((target) => !doneKeys.has(target.key));

  if (dryRun) {
    console.log(JSON.stringify({
      dryRun: true,
      from: from.toISOString(),
      to: to.toISOString(),
      found: targets.length,
      pending: pending.length,
      items: pending.map((x) => ({
        code: x.code,
        name: x.parsed.name,
        jobTitle: x.parsed.jobTitle,
        fileName: x.fileName,
        chatTitle: x.chatTitle,
        date: x.date,
      })),
    }, null, 2));
    return;
  }

  for (const target of pending) candidateSequenceSuffix(target.code, account);

  if (pending.length === 0) {
    try {
      const nextState = JSON.stringify({
        lastScanAt: to.toISOString(),
        lastRunAt: new Date().toISOString(),
        lastFound: targets.length,
        lastImported: 0,
      });
      const committed = await kvEval(EMPTY_RUN_COMMIT_SCRIPT, [stateKey, ledgerKey], [stateRaw, nextState, ledgerRaw]);
      if (!Array.isArray(committed) || Number(committed[0]) !== 1) {
        throw new Error('同步状态在扫描期间已更新，本轮未覆盖；下次任务会基于最新状态继续');
      }
      console.log(JSON.stringify({
        from: from.toISOString(),
        to: to.toISOString(),
        found: targets.length,
        imported: 0,
        skipped: targets.length,
      }, null, 2));
    } finally {
      await client.disconnect();
    }
    return;
  }

  const talentsKey = 'recruit:talents';
  const repushKey = 'recruit:repush';
  const codeLedgerKey = 'recruit:candidate-code-ledger';
  const talentsRaw = snapshotString(await kvGet(talentsKey), talentsKey);
  const repushRaw = snapshotString(await kvGet(repushKey), repushKey);
  const codeLedgerRaw = snapshotString(await kvGet(codeLedgerKey), codeLedgerKey);
  const talents = parseArraySnapshot(talentsRaw, talentsKey);
  const repush = parseArraySnapshot(repushRaw, repushKey);
  let codeLedger = parseArraySnapshot(codeLedgerRaw, codeLedgerKey);

  const byTalentCode = new Map(talents.filter((t) => t?.candidateCode).map((t) => [String(t.candidateCode).toUpperCase(), t]));
  const byCodeLedger = new Map(codeLedger.filter((x) => x?.code).map((x) => [String(x.code).toUpperCase(), x]));
  const businessNamesByCode = new Map();
  function rememberBusinessName(code, name) {
    const normalizedCode = String(code || '').toUpperCase();
    const normalizedName = normalizeIdentity(name);
    if (!normalizedCode || !normalizedName) return;
    if (!businessNamesByCode.has(normalizedCode)) businessNamesByCode.set(normalizedCode, new Set());
    businessNamesByCode.get(normalizedCode).add(normalizedName);
  }
  for (const talent of talents) rememberBusinessName(talent?.candidateCode, talent?.name);
  for (const row of codeLedger) rememberBusinessName(row?.code, row?.name);
  for (const row of repush) rememberBusinessName(row?.candidateCode, row?.candidateName);
  const talentTextWrites = new Map();
  const importedIdentities = new Map();
  const identityRegistry = new Map();
  const identitiesKey = `recruit:candidate-code:identities:${account}`;
  const identityNamesKey = `recruit:candidate-code:identity-names:${account}`;
  const results = [];
  const failures = [];

  async function candidateIdentityRegistryEntry(code) {
    if (!identityRegistry.has(code)) {
      const [candidateIdentityId, name] = await Promise.all([
        kvHGet(identitiesKey, code),
        kvHGet(identityNamesKey, code),
      ]);
      identityRegistry.set(code, {
        candidateIdentityId: candidateIdentityId == null ? '' : String(candidateIdentityId),
        name: name == null ? '' : String(name),
      });
    }
    return identityRegistry.get(code);
  }

  try {
    for (const target of pending) {
      try {
        const p = target.parsed;
        const code = target.code;
        const owner = code.includes('BB') ? 'BB' : 'MMF';
        const knownBusinessNames = businessNamesByCode.get(code) || new Set();
        const knownName = byTalentCode.get(code)?.name
          || byCodeLedger.get(code)?.name
          || repush.find((item) => String(item.candidateCode || '').toUpperCase() === code)?.candidateName
          || '';
        const name = p.name || target.fileName.replace(/\.(pdf|docx?)$/i, '').split(/[-_]/)[0] || code;
        const identityName = normalizeIdentity(p.name || knownName || name);
        if (knownBusinessNames.size > 0 && !knownBusinessNames.has(identityName)) {
          throw new Error(`候选人编号 ${code} 与已有业务记录姓名不一致`);
        }

        let talent = byTalentCode.get(code);
        const nextTalentId = talent?.id || genId();
        const registry = await candidateIdentityRegistryEntry(code);
        const registryName = normalizeIdentity(registry.name);
        const registryMatchesName = !registryName || registryName === identityName;
        const registryIdentityId = registryMatchesName
          && registry.candidateIdentityId
          && registry.candidateIdentityId !== identityName
          && registry.candidateIdentityId !== '!conflict'
          ? registry.candidateIdentityId
          : '';
        const candidateIdentityId = talent?.candidateIdentityId || registryIdentityId || nextTalentId;
        const registryIdentityMismatch = Boolean(registry.candidateIdentityId
          && registry.candidateIdentityId !== '!conflict'
          && registry.candidateIdentityId !== identityName
          && registry.candidateIdentityId !== candidateIdentityId);
        const allowRegistryRepair = knownBusinessNames.has(identityName)
          && (!registryMatchesName || registryIdentityMismatch || registry.candidateIdentityId === '!conflict');
        if ((!registryMatchesName || registry.candidateIdentityId === '!conflict') && !allowRegistryRepair) {
          throw new Error(`候选人编号 ${code} 的身份登记与当前简历不一致`);
        }

        const buffer = await client.downloadMedia(target.msg, {});
        if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error(`TG download failed: ${target.fileName}`);
        const uploaded = await uploadResume(buffer, target.fileName);
        let resumeText = '';
        let parseSource = '';
        let parseError = '';
        try {
          const parsedResume = await parseResumeFromBlob(uploaded.url, target.fileName);
          resumeText = parsedResume.text || '';
          parseSource = parsedResume.source || '';
        } catch (err) {
          parseError = err.message || 'parse failed';
        }

        const jobTitle = p.jobTitle || '';
        const orgDept = splitOrgDept(p.organization);
        const rawText = [target.recommendationText, resumeText ? `\n\n--- resume text ---\n${resumeText}` : ''].filter(Boolean).join('');
        const cats = categories(jobTitle, rawText);
        const now = new Date().toISOString();

        if (!talent) {
          talent = {
          id: nextTalentId,
          candidateCode: code,
          name,
          jobTitle,
          categories: cats,
          resumeUrl: uploaded.url,
          resumeFileName: target.fileName,
          tg: p.contact && p.contact !== '/' ? p.contact : undefined,
          notes: `TG auto sync; ${target.chatTitle}; ${p.source || ''}`.trim(),
          archived: false,
          organization: p.organization || undefined,
          recruiter: p.recommender || undefined,
          createdAt: now,
          updatedAt: now,
        };
          talents.unshift(talent);
          byTalentCode.set(code, talent);
        } else {
          Object.assign(talent, {
          name: talent.name || name,
          jobTitle: jobTitle || talent.jobTitle,
          categories: cats.length ? cats : talent.categories,
          resumeUrl: uploaded.url,
          resumeFileName: target.fileName,
          tg: p.contact && p.contact !== '/' ? p.contact : talent.tg,
          organization: p.organization || talent.organization,
          recruiter: p.recommender || talent.recruiter,
          archived: false,
          updatedAt: now,
          });
        }
        talent.candidateIdentityId = candidateIdentityId;
        recordImportedIdentity(importedIdentities, code, candidateIdentityId, identityName, allowRegistryRepair);
        rememberBusinessName(code, name);
        if (resumeText) {
          talentTextWrites.set(`recruit:talent-text:${talent.id}`, resumeText);
          talent.hasResumeText = true;
          talent.resumeChars = resumeText.replace(/\s+/g, '').length;
        }

        let rec = findExistingRecommendation(repush, code, jobTitle, target.date);
      const deliveredMessageId = String(target.recommendationMessageId || target.messageId || '');
      if (rec) {
        Object.assign(rec, {
          resumeUrl: uploaded.url,
          resumeFileName: target.fileName,
          rawText: rawText.slice(0, 2000),
          talentId: talent.id,
          candidateIdentityId,
          applicationId: rec.applicationId || rec.id,
          deliveryStatus: 'sent',
          deliveryUpdatedAt: target.date,
          telegramMessageId: deliveredMessageId || rec.telegramMessageId,
          deliveredAt: target.date,
        });
      } else {
        rec = {
          id: genId(),
          column: owner === 'BB' ? 'b' : 'a',
          fileName: jobTitle ? `${name}-${jobTitle}` : name,
          candidateCode: code,
          candidateName: name,
          jdTitle: jobTitle || undefined,
          contact: p.contact && p.contact !== '/' ? p.contact : undefined,
          contactPerson: p.recommender || (owner === 'BB' ? 'BOBO @bobomiepucha' : '\u9ea6\u6ee1\u5206 @bruceluo123'),
          rawText: rawText.slice(0, 2000),
          resumeUrl: uploaded.url,
          resumeFileName: target.fileName,
          talentId: talent.id,
          candidateIdentityId,
          deliveryStatus: 'sent',
          deliveryUpdatedAt: target.date,
          telegramMessageId: deliveredMessageId || undefined,
          deliveredAt: target.date,
          feedback: 'pending',
          interviewStatus: 'none',
          organization: orgDept.organization,
          department: orgDept.department,
          uploadedAt: target.date,
        };
        rec.applicationId = rec.id;
        repush.push(rec);
      }

      ledger.push({
        key: target.key,
        code,
        chatId: target.chatId,
        chatTitle: target.chatTitle,
        messageId: target.messageId,
        recommendationMessageId: target.recommendationMessageId,
        fileName: target.fileName,
        resumeUrl: uploaded.url,
        talentId: talent.id,
        repushId: rec.id,
        parsed: !!resumeText,
        parseSource,
        parseError,
        syncedAt: now,
      });
      byCodeLedger.set(code, {
        ...(byCodeLedger.get(code) || {}),
        code,
        owner,
        name,
        jobTitle,
        organization: p.organization,
        source: p.source,
        channel: p.channel,
        recommender: p.recommender,
        contactPerson: p.contactPerson,
        contact: p.contact,
        firstChatTitle: target.chatTitle,
        firstChatId: target.chatId,
        firstMessageDate: target.date,
        firstMessageId: target.recommendationMessageId,
        resumeUrl: uploaded.url,
        resumeFileName: target.fileName,
        recoveredAt: now,
      });
        results.push({ code, name, jobTitle, fileName: target.fileName, chatTitle: target.chatTitle, parsed: !!resumeText, parseError });
      } catch (err) {
        failures.push({
          code: target.code,
          fileName: target.fileName,
          messageId: target.messageId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } finally {
    await client.disconnect();
  }

  codeLedger = [...byCodeLedger.values()].sort((a, b) => String(a.code).localeCompare(String(b.code)));
  const talentTextSnapshots = await Promise.all(Array.from(talentTextWrites, async ([key, value]) => ({
    key,
    expected: snapshotString(await kvGet(key), key),
    value,
  })));
  const nextState = JSON.stringify({
    lastScanAt: to.toISOString(),
    lastRunAt: new Date().toISOString(),
    lastFound: targets.length,
    lastImported: results.length,
  });
  const snapshots = [
    { key: talentsKey, expected: talentsRaw, value: JSON.stringify(talents) },
    { key: repushKey, expected: repushRaw, value: JSON.stringify(repush) },
    { key: codeLedgerKey, expected: codeLedgerRaw, value: JSON.stringify(codeLedger) },
    { key: ledgerKey, expected: ledgerRaw, value: JSON.stringify(ledger.slice(-3000)) },
    { key: stateKey, expected: stateRaw, value: nextState },
    ...talentTextSnapshots,
  ];
  const candidateEntries = Array.from(importedIdentities, ([code, identity]) => [
    code,
    candidateSequenceSuffix(code, account),
    identity === '!conflict' ? '!conflict' : identity.candidateIdentityId,
    identity === '!conflict' ? '!conflict' : identity.name,
    identity === '!conflict' ? '0' : identity.allowRepair ? '1' : '0',
  ]);
  const committed = await kvEval(IMPORT_COMMIT_SCRIPT, [
    ...snapshots.map((snapshot) => snapshot.key),
    'recruit:version',
    `recruit:candidate-code:used:${account}`,
    `recruit:candidate-code:sequence:${account}`,
    identitiesKey,
    identityNamesKey,
  ], [
    String(snapshots.length),
    ...snapshots.map((snapshot) => createHash('sha1').update(snapshot.expected).digest('hex')),
    ...snapshots.map((snapshot) => snapshot.value),
    JSON.stringify(candidateEntries),
  ]);
  if (Array.isArray(committed) && Number(committed[0]) === -1) {
    throw new Error(`候选人编号 ${String(committed[1] || '')} 已绑定其他姓名，本轮业务数据未写入`);
  }
  if (!Array.isArray(committed) || Number(committed[0]) !== 1) {
    const conflictIndex = Array.isArray(committed) ? Number(committed[1]) : 0;
    const conflictKey = snapshots[conflictIndex - 1]?.key;
    throw new Error(`业务数据在同步期间已被其他设备更新，本轮未覆盖${conflictKey ? `（冲突：${conflictKey}）` : ''}；下次任务会基于最新数据重试`);
  }
  const version = Number(committed[1]) || 0;
  console.log(JSON.stringify({
    from: from.toISOString(),
    to: to.toISOString(),
    found: targets.length,
    imported: results.length,
    skipped: targets.length - pending.length,
    failed: failures.length,
    version,
    results,
    failures,
  }, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
