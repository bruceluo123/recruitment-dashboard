#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import bigInt from 'big-integer';
import { Api, TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { CustomFile } from 'telegram/client/uploads.js';

const ROOT = process.cwd();

function loadEnv() {
  for (const fileName of ['.env.local', '.env.supabase.local']) {
    const envPath = path.join(ROOT, fileName);
    if (!fs.existsSync(envPath)) continue;
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*([^#][^=]+)=\s*(.*)\s*$/);
      if (!match) continue;
      const key = match[1].trim();
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  }
}

loadEnv();
const accountArgIndex = process.argv.indexOf('--account');
const accountArg = accountArgIndex !== -1 ? process.argv[accountArgIndex + 1] : '';
const ACCOUNT = (accountArg || process.env.TG_ACCOUNT) === 'b' ? 'b' : 'a';
const QUEUE_KEY = ACCOUNT === 'b' ? 'recruit:tg-delivery-pending-b' : 'recruit:tg-delivery-pending';
const PROCESSING_KEY = ACCOUNT === 'b' ? 'recruit:tg-delivery-processing-b' : 'recruit:tg-delivery-processing';
const DIALOGS_KEY = ACCOUNT === 'b' ? 'recruit:tg-delivery-dialogs-b' : 'recruit:tg-delivery-dialogs';
const HEARTBEAT_KEY = ACCOUNT === 'b' ? 'recruit:tg-delivery-worker-heartbeat-b' : 'recruit:tg-delivery-worker-heartbeat';
const WORKER_ID = `${ACCOUNT}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_BATCHES = 10;
const POLL_INTERVAL_MS = 2_000;
const DIALOG_REFRESH_MS = 15 * 60 * 1_000;
const LEASE_MS = 10 * 60 * 1_000;
const LEASE_RENEW_INTERVAL_MS = 60_000;
const RECORD_TTL_SECONDS = 7 * 24 * 60 * 60;
const RECOVERY_INTERVAL_MS = 60_000;
const HEARTBEAT_INTERVAL_MS = 15_000;
const FETCH_RETRY_DELAYS_MS = [500, 1_500, 3_000];
const FETCH_TIMEOUT_MS = 60_000;
const TG_OPERATION_TIMEOUT_MS = 8 * 60 * 1_000;
const TG_SETUP_TIMEOUT_MS = 2 * 60 * 1_000;
const UPLOAD_WORKERS = 4;
const APPLICATION_MAPPING_LUA = `
local function hasValidApplicationRows(record, repush)
  local applications = record.applications
  if applications == nil then return true end
  if type(applications) ~= 'table' then return false end
  if #applications == 0 then return true end
  local counts = {}
  local total = 0
  for _, item in ipairs(repush) do
    if tostring(item.deliveryId or '') == tostring(record.id or '') then
      total = total + 1
      local key = tostring(tonumber(item.deliveryIndex) or -1) .. '|' .. tostring(item.applicationId or item.id or '')
      counts[key] = (counts[key] or 0) + 1
    end
  end
  if total ~= #applications then return false end
  for _, application in ipairs(applications) do
    local key = tostring(tonumber(application.index) or -1) .. '|' .. tostring(application.applicationId or '')
    if counts[key] ~= 1 then return false end
  end
  return true
end

local function failApplicationMapping(record, now)
  local message = 'Delivery business record mapping is missing or ambiguous'
  local sent = 0
  for _, delivery in ipairs(record.deliveries or {}) do
    if delivery.status == 'sent' or delivery.messageId then
      delivery.status = 'sent'
      sent = sent + 1
    else
      delivery.status = 'failed'
      delivery.error = message
    end
  end
  record.sent = sent
  record.status = sent > 0 and 'partial_failed' or 'failed'
  record.error = message
  record.updatedAt = now
  record.finishedAt = now
  record.lease = nil
  return cjson.encode(record)
end

local function failApplicationRows(record, repushKey, versionKey, now)
  local repushRaw = redis.call('GET', repushKey) or '[]'
  local okRepush, repush = pcall(cjson.decode, repushRaw)
  if not string.match(repushRaw, '^%s*%[') or not okRepush or type(repush) ~= 'table' then return false end
  local changed = false
  local deliveries = record.deliveries or {}
  for _, item in ipairs(repush) do
    if tostring(item.deliveryId or '') == tostring(record.id or '') then
      local deliveryIndex = tonumber(item.deliveryIndex)
      local delivery = deliveryIndex and deliveries[deliveryIndex + 1] or nil
      local nextStatus = delivery and (delivery.status == 'sent' or delivery.messageId) and 'sent' or 'failed'
      local nextMessageId = delivery and delivery.messageId and tostring(delivery.messageId) or ''
      local nextDeliveredAt = delivery and delivery.sentAt and tostring(delivery.sentAt) or ''
      if tostring(item.deliveryStatus or '') ~= nextStatus
        or tostring(item.telegramMessageId or '') ~= nextMessageId
        or tostring(item.deliveredAt or '') ~= nextDeliveredAt then
        item.deliveryStatus = nextStatus
        item.telegramMessageId = nextMessageId ~= '' and nextMessageId or nil
        item.deliveredAt = nextDeliveredAt ~= '' and nextDeliveredAt or nil
        item.deliveryUpdatedAt = now
        changed = true
      end
    end
  end
  if changed then
    redis.call('SET', repushKey, cjson.encode(repush))
    redis.call('INCR', versionKey)
  end
  return true
end
`;
const CLAIM_SCRIPT = `${APPLICATION_MAPPING_LUA}
local id = redis.call('LPOP', KEYS[1])
if not id then return false end
local recordKey = ARGV[1] .. id
local raw = redis.call('GET', recordKey)
if not raw then return false end
local ok, record = pcall(cjson.decode, raw)
if not ok or type(record) ~= 'table' or record.status ~= 'queued' then return false end
local now = ARGV[3]
local existingLease = record.lease
if existingLease and existingLease.workerId ~= ARGV[2] and existingLease.expiresAt and existingLease.expiresAt > now then
  redis.call('RPUSH', KEYS[1], id)
  return false
end
if record.applications ~= nil then
  local repushRaw = redis.call('GET', KEYS[3]) or '[]'
  local okRepush, repush = pcall(cjson.decode, repushRaw)
  if not string.match(repushRaw, '^%s*%[') or not okRepush or type(repush) ~= 'table'
    or not hasValidApplicationRows(record, repush) then
    local failedRaw = failApplicationMapping(record, now)
    failApplicationRows(record, KEYS[3], KEYS[4], now)
    redis.call('SET', recordKey, failedRaw, 'EX', ARGV[5])
    redis.call('LREM', KEYS[2], 0, id)
    return false
  end
end
record.status = 'sending'
record.updatedAt = now
record.lease = { workerId = ARGV[2], claimedAt = now, expiresAt = ARGV[4] }
local nextRaw = cjson.encode(record)
redis.call('SET', recordKey, nextRaw, 'EX', ARGV[5])
redis.call('RPUSH', KEYS[2], id)
return { id, nextRaw }
`;
const SYNC_REPUSH_RECORDS_LUA = `${APPLICATION_MAPPING_LUA}
local function syncRepushRecords(record, repushKey, versionKey)
  local repushRaw = redis.call('GET', repushKey) or '[]'
  local okRepush, repush = pcall(cjson.decode, repushRaw)
  if not string.match(repushRaw, '^%s*%[') or not okRepush or type(repush) ~= 'table' then return false end
  if not hasValidApplicationRows(record, repush) then return false end
  local changed = false
  local deliveries = record.deliveries or {}
  for _, item in ipairs(repush) do
    if item.deliveryId == record.id then
      local deliveryIndex = tonumber(item.deliveryIndex)
      local delivery = deliveryIndex and deliveries[deliveryIndex + 1] or nil
      if delivery then
        local nextStatus = 'queued'
        if delivery.status == 'sent' or delivery.messageId then
          nextStatus = 'sent'
        elseif delivery.status == 'failed' then
          nextStatus = 'failed'
        elseif delivery.status == 'sending' then
          nextStatus = 'sending'
        end
        local nextMessageId = delivery.messageId and tostring(delivery.messageId) or ''
        local nextDeliveredAt = delivery.sentAt and tostring(delivery.sentAt) or ''
        if tostring(item.deliveryStatus or '') ~= nextStatus
          or tostring(item.telegramMessageId or '') ~= nextMessageId
          or tostring(item.deliveredAt or '') ~= nextDeliveredAt then
          item.deliveryStatus = nextStatus
          item.telegramMessageId = nextMessageId ~= '' and nextMessageId or nil
          item.deliveredAt = nextDeliveredAt ~= '' and nextDeliveredAt or nil
          item.deliveryUpdatedAt = record.updatedAt
          changed = true
        end
      end
    end
  end
  if changed then
    redis.call('SET', repushKey, cjson.encode(repush))
    redis.call('INCR', versionKey)
  end
  return true
end
`;
const LEASE_SAVE_SCRIPT = `${SYNC_REPUSH_RECORDS_LUA}
local currentRaw = redis.call('GET', KEYS[1])
if not currentRaw or currentRaw ~= ARGV[1] then return {0} end
local ok, current = pcall(cjson.decode, currentRaw)
if not ok or type(current) ~= 'table' then return {-1} end
local lease = current.lease
if current.status ~= 'sending' or not lease or lease.workerId ~= ARGV[2] or not lease.expiresAt or lease.expiresAt <= ARGV[3] then return {-1} end
local okNext, nextRecord = pcall(cjson.decode, ARGV[4])
if not okNext or type(nextRecord) ~= 'table' or not nextRecord.lease or nextRecord.lease.workerId ~= ARGV[2] then return {-1} end
if not syncRepushRecords(nextRecord, KEYS[2], KEYS[3]) then
  local failedRaw = failApplicationMapping(nextRecord, ARGV[3])
  failApplicationRows(nextRecord, KEYS[2], KEYS[3], ARGV[3])
  redis.call('SET', KEYS[1], failedRaw, 'EX', ARGV[5])
  redis.call('LREM', KEYS[4], 0, nextRecord.id)
  return {-2, failedRaw}
end
redis.call('SET', KEYS[1], ARGV[4], 'EX', ARGV[5])
return {1}
`;
const FINISH_SCRIPT = `${SYNC_REPUSH_RECORDS_LUA}
local currentRaw = redis.call('GET', KEYS[1])
if not currentRaw or currentRaw ~= ARGV[1] then return {0} end
local ok, current = pcall(cjson.decode, currentRaw)
if not ok or type(current) ~= 'table' then return {-1} end
local lease = current.lease
if current.status ~= 'sending' or not lease or lease.workerId ~= ARGV[2] or not lease.expiresAt or lease.expiresAt <= ARGV[3] then return {-1} end
local okNext, nextRecord = pcall(cjson.decode, ARGV[4])
if not okNext or type(nextRecord) ~= 'table' then return {-1} end
if not syncRepushRecords(nextRecord, KEYS[3], KEYS[4]) then
  local failedRaw = failApplicationMapping(nextRecord, ARGV[3])
  failApplicationRows(nextRecord, KEYS[3], KEYS[4], ARGV[3])
  redis.call('SET', KEYS[1], failedRaw, 'EX', ARGV[5])
  redis.call('LREM', KEYS[2], 0, ARGV[6])
  return {-2, failedRaw}
end
redis.call('SET', KEYS[1], ARGV[4], 'EX', ARGV[5])
redis.call('LREM', KEYS[2], 0, ARGV[6])
return {1}
`;
const RELEASE_SCRIPT = `${SYNC_REPUSH_RECORDS_LUA}
local currentRaw = redis.call('GET', KEYS[1])
if not currentRaw or currentRaw ~= ARGV[1] then return {0} end
local ok, record = pcall(cjson.decode, currentRaw)
if not ok or type(record) ~= 'table' then return {-1} end
local lease = record.lease
if record.status ~= 'sending' or not lease or lease.workerId ~= ARGV[2] or not lease.expiresAt or lease.expiresAt <= ARGV[3] then return {-1} end
record.status = 'queued'
record.updatedAt = ARGV[3]
record.recoveredAt = record.updatedAt
record.lease = nil
for _, delivery in ipairs(record.deliveries or {}) do
  if delivery.status == 'sending' then delivery.status = 'pending' end
end
local nextRaw = cjson.encode(record)
if not syncRepushRecords(record, KEYS[4], KEYS[5]) then
  local failedRaw = failApplicationMapping(record, ARGV[3])
  failApplicationRows(record, KEYS[4], KEYS[5], ARGV[3])
  redis.call('SET', KEYS[1], failedRaw, 'EX', ARGV[4])
  redis.call('LREM', KEYS[2], 0, ARGV[5])
  redis.call('LREM', KEYS[3], 0, ARGV[5])
  return {-2, failedRaw}
end
redis.call('SET', KEYS[1], nextRaw, 'EX', ARGV[4])
redis.call('LREM', KEYS[2], 0, ARGV[5])
redis.call('LREM', KEYS[3], 0, ARGV[5])
redis.call('RPUSH', KEYS[3], ARGV[5])
return {1}
`;
const RECOVER_SCRIPT = `${SYNC_REPUSH_RECORDS_LUA}
local raw = redis.call('GET', KEYS[3])
if not raw then redis.call('LREM', KEYS[1], 0, ARGV[1]); return {0} end
local ok, record = pcall(cjson.decode, raw)
if not ok or type(record) ~= 'table' then redis.call('LREM', KEYS[1], 0, ARGV[1]); return {0} end
local terminal = record.status == 'sent' or record.status == 'failed' or record.status == 'partial_failed'
if terminal then redis.call('LREM', KEYS[1], 0, ARGV[1]); return {0} end
local lease = record.lease
if record.status == 'sending' and lease and lease.expiresAt and lease.expiresAt > ARGV[2] then return {0} end
local deliveries = record.deliveries or {}
local sent = 0
for _, delivery in ipairs(deliveries) do
  if delivery.status == 'sent' or delivery.messageId then
    delivery.status = 'sent'
    sent = sent + 1
  elseif delivery.status == 'sending' then
    delivery.status = 'pending'
  end
end
record.sent = sent
record.updatedAt = ARGV[2]
record.recoveredAt = ARGV[2]
record.lease = nil
if #deliveries > 0 and sent == #deliveries then
  record.status = 'sent'
  record.error = nil
  record.finishedAt = ARGV[2]
  if not syncRepushRecords(record, KEYS[4], KEYS[5]) then
    local failedRaw = failApplicationMapping(record, ARGV[2])
    failApplicationRows(record, KEYS[4], KEYS[5], ARGV[2])
    redis.call('SET', KEYS[3], failedRaw, 'EX', ARGV[3])
    redis.call('LREM', KEYS[1], 0, ARGV[1])
    redis.call('LREM', KEYS[2], 0, ARGV[1])
    return {-2, failedRaw}
  end
  redis.call('SET', KEYS[3], cjson.encode(record), 'EX', ARGV[3])
  redis.call('LREM', KEYS[1], 0, ARGV[1])
  return {2}
end
record.status = 'queued'
record.finishedAt = nil
if not syncRepushRecords(record, KEYS[4], KEYS[5]) then
  local failedRaw = failApplicationMapping(record, ARGV[2])
  failApplicationRows(record, KEYS[4], KEYS[5], ARGV[2])
  redis.call('SET', KEYS[3], failedRaw, 'EX', ARGV[3])
  redis.call('LREM', KEYS[1], 0, ARGV[1])
  redis.call('LREM', KEYS[2], 0, ARGV[1])
  return {-2, failedRaw}
end
redis.call('SET', KEYS[3], cjson.encode(record), 'EX', ARGV[3])
redis.call('LREM', KEYS[1], 0, ARGV[1])
redis.call('LREM', KEYS[2], 0, ARGV[1])
redis.call('RPUSH', KEYS[2], ARGV[1])
return {1}
`;

function tgEnv(name) {
  return process.env[ACCOUNT === 'b' ? `TG_BB_${name}` : `TG_${name}`] || '';
}

function parseProxy(raw) {
  if (!raw) return undefined;
  const match = raw.match(/^(?:(socks5|socks4):\/\/)?([^:]+):(\d+)$/i);
  if (!match) throw new Error('TG_PROXY format should be host:port or socks5://host:port');
  return {
    ip: match[2],
    port: Number.parseInt(match[3], 10),
    socksType: match[1]?.toLowerCase() === 'socks4' ? 4 : 5,
    timeout: 10,
  };
}

function kvHeaders(contentType) {
  return {
    Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
    ...(contentType ? { 'Content-Type': contentType } : {}),
  };
}

function supabaseConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

async function supabaseRpc(name, body) {
  const base = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const response = await fetchWithRetry(`${base}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Supabase ${name} failed: ${response.status}`);
  return response.json();
}

async function supabaseReadRaw(keys) {
  return supabaseRpc('recruit_kv_read', { p_keys: keys });
}

async function supabaseTx(payload) {
  return supabaseRpc('recruit_kv_tx', { p_payload: payload });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(input, init) {
  let lastError;
  for (let attempt = 0; attempt <= FETCH_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const response = await fetch(input, {
        ...init,
        signal: init?.signal || AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (response.status < 500 || attempt === FETCH_RETRY_DELAYS_MS.length) return response;
      if (response.body) await response.body.cancel().catch(() => {});
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await wait(FETCH_RETRY_DELAYS_MS[attempt]);
  }
  throw lastError || new Error('Network request failed');
}

function parseStored(value) {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}

async function kvCommand(command, ...args) {
  if (supabaseConfigured()) {
    const name = String(command).toLowerCase();
    const values = await supabaseReadRaw([args[0]]);
    if (name === 'get') return parseStored(values[args[0]] ?? null);
    if (name === 'lrange') {
      let list = [];
      try { list = JSON.parse(values[args[0]] || '[]'); } catch { list = []; }
      const start = Number.parseInt(args[1] || '0', 10);
      const stop = Number.parseInt(args[2] || '-1', 10);
      return list.slice(start, stop < 0 ? undefined : stop + 1);
    }
    if (name === 'lrem') {
      const result = await supabaseTx({ lists: [{ op: 'remove', key: args[0], count: Number(args[1]) || 0, value: args[2] }] });
      return result.ok ? 1 : 0;
    }
    if (name === 'expire') {
      if (!(args[0] in values)) return 0;
      const result = await supabaseTx({ writes: [{ key: args[0], value: values[args[0]], ttlSeconds: Number(args[1]) || 0 }] });
      return result.ok ? 1 : 0;
    }
  }
  const url = `${process.env.KV_REST_API_URL}/${command}/${args.map((value) => encodeURIComponent(value)).join('/')}`;
  const response = await fetchWithRetry(url, { headers: kvHeaders() });
  if (!response.ok) throw new Error(`KV ${command} failed: ${response.status}`);
  return parseStored((await response.json()).result);
}

async function kvGet(key) {
  return kvCommand('get', key);
}

async function kvSet(key, value) {
  if (supabaseConfigured()) {
    const result = await supabaseTx({ writes: [{ key, value: JSON.stringify(value) }] });
    if (!result.ok) throw new Error('Supabase set failed');
    return;
  }
  const response = await fetchWithRetry(`${process.env.KV_REST_API_URL}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: kvHeaders('application/json'),
    body: JSON.stringify(value),
  });
  if (!response.ok) throw new Error(`KV set failed: ${response.status}`);
}

async function kvLRange(key, start, stop) {
  const result = await kvCommand('lrange', key, String(start), String(stop));
  return Array.isArray(result) ? result : [];
}

async function kvLRem(key, count, value) {
  return kvCommand('lrem', key, String(count), value);
}

function parseRawArray(raw) {
  try {
    const value = JSON.parse(raw || '[]');
    return Array.isArray(value) ? value : null;
  } catch { return null; }
}

function applicationRowsValid(record, repush) {
  if (record.applications == null || record.applications.length === 0) return true;
  if (!Array.isArray(record.applications)) return false;
  const rows = repush.filter((item) => String(item.deliveryId || '') === String(record.id || ''));
  if (rows.length !== record.applications.length) return false;
  const counts = new Map();
  for (const item of rows) {
    const key = `${Number(item.deliveryIndex ?? -1)}|${String(item.applicationId || item.id || '')}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return record.applications.every((item) => counts.get(`${Number(item.index ?? -1)}|${String(item.applicationId || '')}`) === 1);
}

function syncRepushSnapshot(record, repushRaw) {
  const repush = parseRawArray(repushRaw);
  if (!repush || !applicationRowsValid(record, repush)) return null;
  let changed = false;
  const next = repush.map((item) => {
    if (item.deliveryId !== record.id) return item;
    const delivery = record.deliveries?.[Number(item.deliveryIndex) || 0];
    if (!delivery) return item;
    const status = delivery.status === 'sent' || delivery.messageId
      ? 'sent'
      : delivery.status === 'failed'
        ? 'failed'
        : delivery.status === 'sending'
          ? 'sending'
          : 'queued';
    const messageId = delivery.messageId ? String(delivery.messageId) : undefined;
    const deliveredAt = delivery.sentAt ? String(delivery.sentAt) : undefined;
    if (item.deliveryStatus === status && item.telegramMessageId === messageId && item.deliveredAt === deliveredAt) return item;
    changed = true;
    return { ...item, deliveryStatus: status, telegramMessageId: messageId, deliveredAt, deliveryUpdatedAt: record.updatedAt };
  });
  return { changed, raw: JSON.stringify(next) };
}

async function supabaseClaim(keys, args) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const snapshots = await supabaseReadRaw([keys[0]]);
    const queueRaw = snapshots[keys[0]];
    const queue = parseRawArray(queueRaw);
    if (!queue?.length) return null;
    const id = String(queue[0]);
    const recordKeyValue = `${args[0]}${id}`;
    const values = await supabaseReadRaw([recordKeyValue, keys[2]]);
    const raw = values[recordKeyValue];
    const record = raw ? parseStored(raw) : null;
    const repushRaw = values[keys[2]];
    if (!record || typeof record !== 'object' || record.status !== 'queued') {
      const skipped = await supabaseTx({
        expected: [{ key: keys[0], exists: Boolean(queueRaw), ...(queueRaw ? { value: queueRaw } : {}) }],
        writes: [{ key: keys[0], value: JSON.stringify(queue.slice(1)) }],
      });
      if (skipped.ok) continue;
      continue;
    }
    const lease = record.lease;
    const activeLease = lease && lease.workerId !== args[1] && lease.expiresAt && lease.expiresAt > args[2];
    const nextQueue = activeLease ? [...queue.slice(1), id] : queue.slice(1);
    if (activeLease) {
      const deferred = await supabaseTx({
        expected: [{ key: keys[0], exists: true, value: queueRaw }],
        writes: [{ key: keys[0], value: JSON.stringify(nextQueue) }],
      });
      if (deferred.ok) return null;
      continue;
    }
    if (!applicationRowsValid(record, parseRawArray(repushRaw) || [])) return null;
    record.status = 'sending';
    record.updatedAt = args[2];
    record.lease = { workerId: args[1], claimedAt: args[2], expiresAt: args[3] };
    const nextRaw = JSON.stringify(record);
    const committed = await supabaseTx({
      expected: [
        { key: keys[0], exists: true, value: queueRaw },
        { key: recordKeyValue, exists: true, value: raw },
      ],
      writes: [
        { key: keys[0], value: JSON.stringify(nextQueue) },
        { key: recordKeyValue, value: nextRaw, ttlSeconds: Number(args[4]) || RECORD_TTL_SECONDS },
      ],
      lists: [{ op: 'push', key: keys[1], value: id }],
    });
    if (committed.ok) return [id, nextRaw];
  }
  return null;
}

async function supabaseSaveRecord(keys, args, mode) {
  const values = await supabaseReadRaw([keys[0], mode === 'finish' ? keys[2] : keys[1]]);
  const currentRaw = values[keys[0]];
  if (!currentRaw || currentRaw !== args[0]) return [0];
  const current = parseStored(currentRaw);
  const now = args[2];
  if (!current || current.status !== 'sending' || current.lease?.workerId !== args[1]
    || !current.lease?.expiresAt || current.lease.expiresAt <= now) return [-1];
  const nextRecord = parseStored(args[3]);
  if (!nextRecord || typeof nextRecord !== 'object') return [-1];
  const repushKey = mode === 'finish' ? keys[2] : keys[1];
  const versionKey = mode === 'finish' ? keys[3] : keys[2];
  const repushRaw = values[repushKey];
  const synced = syncRepushSnapshot(nextRecord, repushRaw);
  if (!synced) return [-2];
  const committed = await supabaseTx({
    expected: [
      { key: keys[0], exists: true, value: currentRaw },
      { key: repushKey, exists: Boolean(repushRaw), ...(repushRaw ? { value: repushRaw } : {}) },
    ],
    writes: [
      { key: keys[0], value: args[3], ttlSeconds: Number(args[4]) || RECORD_TTL_SECONDS },
      ...(synced.changed ? [{ key: repushKey, value: synced.raw }] : []),
    ],
    increments: synced.changed ? [versionKey] : [],
    lists: mode === 'finish' ? [{ op: 'remove', key: keys[1], count: 0, value: args[5] }] : [],
  });
  return committed.ok ? [1] : [0];
}

async function supabaseRelease(keys, args) {
  const values = await supabaseReadRaw([keys[0], keys[3]]);
  const raw = values[keys[0]];
  if (!raw || raw !== args[0]) return [0];
  const record = parseStored(raw);
  if (!record || record.status !== 'sending' || record.lease?.workerId !== args[1]
    || !record.lease?.expiresAt || record.lease.expiresAt <= args[2]) return [-1];
  record.status = 'queued';
  record.updatedAt = args[2];
  record.recoveredAt = args[2];
  delete record.lease;
  for (const delivery of record.deliveries || []) if (delivery.status === 'sending') delivery.status = 'pending';
  const repushRaw = values[keys[3]];
  const synced = syncRepushSnapshot(record, repushRaw);
  if (!synced) return [-2];
  const committed = await supabaseTx({
    expected: [
      { key: keys[0], exists: true, value: raw },
      { key: keys[3], exists: Boolean(repushRaw), ...(repushRaw ? { value: repushRaw } : {}) },
    ],
    writes: [
      { key: keys[0], value: JSON.stringify(record), ttlSeconds: Number(args[3]) || RECORD_TTL_SECONDS },
      ...(synced.changed ? [{ key: keys[3], value: synced.raw }] : []),
    ],
    increments: synced.changed ? [keys[4]] : [],
    lists: [
      { op: 'remove', key: keys[1], count: 0, value: args[4] },
      { op: 'remove', key: keys[2], count: 0, value: args[4] },
      { op: 'push', key: keys[2], value: args[4] },
    ],
  });
  return committed.ok ? [1] : [0];
}

async function supabaseRecover(keys, args) {
  const values = await supabaseReadRaw([keys[2], keys[3]]);
  const raw = values[keys[2]];
  const record = raw ? parseStored(raw) : null;
  if (!record || typeof record !== 'object') {
    await supabaseTx({ lists: [{ op: 'remove', key: keys[0], count: 0, value: args[0] }] });
    return [0];
  }
  if (['sent', 'failed', 'partial_failed'].includes(record.status)) {
    await supabaseTx({ lists: [{ op: 'remove', key: keys[0], count: 0, value: args[0] }] });
    return [0];
  }
  if (record.status === 'sending' && record.lease?.expiresAt > args[1]) return [0];
  const deliveries = record.deliveries || [];
  let sent = 0;
  for (const delivery of deliveries) {
    if (delivery.status === 'sent' || delivery.messageId) { delivery.status = 'sent'; sent += 1; }
    else if (delivery.status === 'sending') delivery.status = 'pending';
  }
  record.sent = sent;
  record.updatedAt = args[1];
  record.recoveredAt = args[1];
  delete record.lease;
  const complete = deliveries.length > 0 && sent === deliveries.length;
  record.status = complete ? 'sent' : 'queued';
  if (complete) { delete record.error; record.finishedAt = args[1]; }
  else delete record.finishedAt;
  const repushRaw = values[keys[3]];
  const synced = syncRepushSnapshot(record, repushRaw);
  if (!synced) return [-2];
  const committed = await supabaseTx({
    expected: [
      { key: keys[2], exists: true, value: raw },
      { key: keys[3], exists: Boolean(repushRaw), ...(repushRaw ? { value: repushRaw } : {}) },
    ],
    writes: [
      { key: keys[2], value: JSON.stringify(record), ttlSeconds: Number(args[2]) || RECORD_TTL_SECONDS },
      ...(synced.changed ? [{ key: keys[3], value: synced.raw }] : []),
    ],
    increments: synced.changed ? [keys[4]] : [],
    lists: [
      { op: 'remove', key: keys[0], count: 0, value: args[0] },
      { op: 'remove', key: keys[1], count: 0, value: args[0] },
      ...(!complete ? [{ op: 'push', key: keys[1], value: args[0] }] : []),
    ],
  });
  return committed.ok ? [complete ? 2 : 1] : [0];
}

async function kvEval(script, keys, args = []) {
  if (supabaseConfigured()) {
    if (script === CLAIM_SCRIPT) return supabaseClaim(keys, args);
    if (script === LEASE_SAVE_SCRIPT) return supabaseSaveRecord(keys, args, 'lease');
    if (script === FINISH_SCRIPT) return supabaseSaveRecord(keys, args, 'finish');
    if (script === RELEASE_SCRIPT) return supabaseRelease(keys, args);
    if (script === RECOVER_SCRIPT) return supabaseRecover(keys, args);
    throw new Error('Unsupported Supabase TG transaction');
  }
  const response = await fetchWithRetry(process.env.KV_REST_API_URL, {
    method: 'POST',
    headers: kvHeaders('application/json'),
    body: JSON.stringify(['EVAL', script, keys.length, ...keys, ...args]),
  });
  if (!response.ok) throw new Error(`KV eval failed: ${response.status}`);
  const data = await response.json();
  if (data.error) throw new Error(`KV eval failed: ${data.error}`);
  return parseStored(data.result);
}

async function kvExpire(key, seconds) {
  return kvCommand('expire', key, String(seconds));
}

function recordKey(id) {
  return `recruit:tg-delivery:${id}`;
}

function recordSnapshot(record) {
  return record._leaseSnapshot || '';
}

function setRecordSnapshot(record, raw) {
  Object.defineProperty(record, '_leaseSnapshot', { value: raw, writable: true, configurable: true });
  return record;
}

function parseRecordSnapshot(raw) {
  const record = parseStored(raw);
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('Invalid TG delivery record');
  return setRecordSnapshot(record, raw);
}

class LeaseLostError extends Error {
  constructor(id) {
    super(`TG delivery lease lost: ${id}`);
    this.name = 'LeaseLostError';
  }
}

class DeliveryMappingError extends Error {
  constructor(id) {
    super(`TG delivery business record mapping is missing or ambiguous: ${id}`);
    this.name = 'DeliveryMappingError';
  }
}

class FatalOperationTimeoutError extends Error {
  constructor(label) {
    super(`${label} timed out; worker will restart before processing more deliveries`);
    this.name = 'FatalOperationTimeoutError';
  }
}

async function withTimeout(task, timeoutMs, label) {
  let timer;
  try {
    return await Promise.race([
      task,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new FatalOperationTimeoutError(label)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function saveLeaseRecord(record) {
  const expectedRaw = recordSnapshot(record);
  const now = new Date();
  record.status = 'sending';
  record.updatedAt = now.toISOString();
  record.lease = {
    workerId: WORKER_ID,
    claimedAt: record.lease?.workerId === WORKER_ID ? record.lease.claimedAt : record.updatedAt,
    expiresAt: new Date(now.getTime() + LEASE_MS).toISOString(),
  };
  const nextRaw = JSON.stringify(record);
  const result = await kvEval(LEASE_SAVE_SCRIPT, [recordKey(record.id), 'recruit:repush', 'recruit:version', PROCESSING_KEY], [
    expectedRaw,
    WORKER_ID,
    now.toISOString(),
    nextRaw,
    String(RECORD_TTL_SECONDS),
  ]);
  if (Array.isArray(result) && Number(result[0]) === -2) throw new DeliveryMappingError(record.id);
  if (!Array.isArray(result) || Number(result[0]) !== 1) throw new LeaseLostError(record.id);
  setRecordSnapshot(record, nextRaw);
}

async function withLeaseRenewal(record, operation) {
  let leaseError = null;
  let renewal = Promise.resolve();
  const timer = setInterval(() => {
    if (leaseError) return;
    renewal = renewal
      .then(() => saveLeaseRecord(record))
      .catch((error) => { leaseError = error; });
  }, LEASE_RENEW_INTERVAL_MS);
  let result;
  let operationError;
  try { result = await operation(); }
  catch (error) { operationError = error; }
  finally {
    clearInterval(timer);
    await renewal;
  }
  if (leaseError) throw leaseError;
  if (operationError) throw operationError;
  return result;
}

async function finishClaim(record) {
  const expectedRaw = recordSnapshot(record);
  const now = new Date().toISOString();
  finishRecord(record);
  const nextRaw = JSON.stringify(record);
  const result = await kvEval(FINISH_SCRIPT, [recordKey(record.id), PROCESSING_KEY, 'recruit:repush', 'recruit:version'], [
    expectedRaw,
    WORKER_ID,
    now,
    nextRaw,
    String(RECORD_TTL_SECONDS),
    record.id,
  ]);
  if (Array.isArray(result) && Number(result[0]) === -2) throw new DeliveryMappingError(record.id);
  if (!Array.isArray(result) || Number(result[0]) !== 1) throw new LeaseLostError(record.id);
  setRecordSnapshot(record, nextRaw);
}

function normalizeDeliveries(record) {
  const legacySent = Math.max(0, Number(record.sent) || 0);
  const deliveries = Array.isArray(record.deliveries) ? record.deliveries : [];
  record.deliveries = deliveries;
  deliveries.forEach((delivery, index) => {
    const recordedSuccess = delivery?.status === 'sent' || delivery?.messageId != null || index < legacySent;
    delivery.status = recordedSuccess ? 'sent' : delivery?.status || 'pending';
  });
  record.sent = deliveries.filter((delivery) => delivery.status === 'sent').length;
  return deliveries;
}

function telegramMessageId(result) {
  const message = Array.isArray(result) ? result.find((item) => item?.id != null) : result;
  const id = message?.id ?? message?.message?.id;
  return id == null ? undefined : String(id);
}

function messageFileName(message) {
  for (const attribute of message?.document?.attributes || []) {
    if (attribute instanceof Api.DocumentAttributeFilename || attribute?.className === 'DocumentAttributeFilename') {
      return String(attribute.fileName || '');
    }
  }
  return String(message?.file?.name || '');
}

function normalizedDeliveryText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizedDeliveryFileName(value) {
  return String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

async function findDeliveredMessage(client, entity, record, delivery) {
  const expectedText = normalizedDeliveryText(String(delivery.text || '').slice(0, 1000));
  const expectedFileName = normalizedDeliveryFileName(delivery.fileName);
  if (!expectedText || !expectedFileName) return null;
  const createdAt = new Date(record.createdAt || 0).getTime();
  const earliest = Number.isFinite(createdAt) ? createdAt - 5 * 60 * 1000 : 0;
  const messages = await client.getMessages(entity, { limit: 200 });
  const match = messages.find((message) => {
    const messageAt = Number(message?.date || 0) * 1000;
    return message?.out === true
      && messageAt >= earliest
      && normalizedDeliveryText(message.message) === expectedText
      && normalizedDeliveryFileName(messageFileName(message)) === expectedFileName;
  });
  if (!match) return null;
  return {
    messageId: telegramMessageId(match),
    sentAt: new Date(Number(match.date || 0) * 1000).toISOString(),
  };
}

function markDeliveryReconciled(delivery, match) {
  delivery.status = 'sent';
  delivery.sentAt = match.sentAt || delivery.sentAt || new Date().toISOString();
  if (match.messageId) delivery.messageId = match.messageId;
  delete delivery.error;
}

function deterministicRandomId(recordId, index) {
  const hex = createHash('sha256').update(`${recordId}:${index}`).digest('hex').slice(0, 16);
  let value = BigInt(`0x${hex}`);
  if (value >= 2n ** 63n) value -= 2n ** 64n;
  if (value === 0n) value = 1n;
  return bigInt(value.toString());
}

function deliveryMimeType(fileName) {
  const extension = path.extname(String(fileName || '')).toLowerCase();
  if (extension === '.pdf') return 'application/pdf';
  if (extension === '.doc') return 'application/msword';
  if (extension === '.docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (extension === '.png') return 'image/png';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  return 'application/octet-stream';
}

async function sendDelivery(client, entity, recordId, index, delivery, buffer) {
  const file = await client.uploadFile({
    file: new CustomFile(delivery.fileName, buffer.length, '', buffer),
    workers: UPLOAD_WORKERS,
  });
  const request = new Api.messages.SendMedia({
    peer: entity,
    media: new Api.InputMediaUploadedDocument({
      file,
      mimeType: deliveryMimeType(delivery.fileName),
      attributes: [new Api.DocumentAttributeFilename({ fileName: delivery.fileName })],
      forceFile: true,
    }),
    message: String(delivery.text || '').slice(0, 1000),
    randomId: deterministicRandomId(recordId, index),
  });
  const result = await client.invoke(request);
  return client._getResponseMessage(request, result, entity);
}

function finishRecord(record) {
  const deliveries = normalizeDeliveries(record);
  const sent = record.sent;
  const errors = deliveries.filter((delivery) => delivery.status !== 'sent' && delivery.error).map((delivery) => delivery.error);
  record.status = sent === deliveries.length && deliveries.length > 0
    ? 'sent'
    : sent > 0
      ? 'partial_failed'
      : 'failed';
  record.error = errors[0] || (record.status === 'sent' ? undefined : 'TG delivery failed');
  record.updatedAt = new Date().toISOString();
  record.finishedAt = record.updatedAt;
  delete record.lease;
  if (record.status === 'sent') delete record.error;
}

async function claimNext() {
  const now = new Date();
  const result = await kvEval(CLAIM_SCRIPT, [QUEUE_KEY, PROCESSING_KEY, 'recruit:repush', 'recruit:version'], [
    'recruit:tg-delivery:',
    WORKER_ID,
    now.toISOString(),
    new Date(now.getTime() + LEASE_MS).toISOString(),
    String(RECORD_TTL_SECONDS),
  ]);
  if (!Array.isArray(result) || result.length < 2 || result[0] == null) return null;
  const id = String(result[0]);
  const record = parseRecordSnapshot(String(result[1]));
  if (record.id !== id) throw new Error(`Claimed delivery record ID mismatch: ${id}`);
  return { id, record };
}

async function releaseClaim(claim) {
  const record = claim.record;
  const result = await kvEval(RELEASE_SCRIPT, [recordKey(claim.id), PROCESSING_KEY, QUEUE_KEY, 'recruit:repush', 'recruit:version'], [
    recordSnapshot(record),
    WORKER_ID,
    new Date().toISOString(),
    String(RECORD_TTL_SECONDS),
    claim.id,
  ]);
  return Array.isArray(result) && Number(result[0]) === 1;
}

async function recoverStaleClaims() {
  const ids = [...new Set((await kvLRange(PROCESSING_KEY, 0, -1)).map(String))];
  let recovered = 0;
  for (const id of ids) {
    const result = await kvEval(RECOVER_SCRIPT, [PROCESSING_KEY, QUEUE_KEY, recordKey(id), 'recruit:repush', 'recruit:version'], [
      id,
      new Date().toISOString(),
      String(RECORD_TTL_SECONDS),
    ]);
    if (Array.isArray(result) && Number(result[0]) === 1) recovered += 1;
  }
  if (recovered) console.log(JSON.stringify({ recovered, at: new Date().toISOString() }));
  return recovered;
}

function dialogItems(dialogs) {
  return dialogs.flatMap((dialog) => {
    const entity = dialog.entity || {};
    const id = dialog.id?.toString() || '';
    const username = entity.username ? `@${entity.username}` : '';
    const personName = [entity.firstName, entity.lastName].filter(Boolean).join(' ');
    const title = String(dialog.title || dialog.name || entity.title || personName || username || id).trim();
    if (!id || !title) return [];
    return [{
      id,
      target: username || id,
      title,
      username,
      type: dialog.isUser ? '私聊' : dialog.isGroup ? '群组' : dialog.isChannel ? '频道' : '会话',
    }];
  });
}

async function resolveTarget(client, rawTarget, dialogs) {
  const target = String(rawTarget || '').trim().replace(/^https?:\/\/t\.me\//i, '@');
  try {
    return await client.getInputEntity(target);
  } catch {
    // 私有群和旧会话继续从当前 dialogs 中匹配 access hash。
  }
  const normalized = target.replace(/^@/, '').replace(/^-100/, '').toLowerCase();
  for (const dialog of dialogs) {
    const entity = dialog.entity || {};
    const id = dialog.id?.toString() || '';
    const username = String(entity.username || '').toLowerCase();
    const title = String(dialog.title || dialog.name || '').trim().toLowerCase();
    if (id === target || id.replace(/^-100/, '') === normalized || username === normalized || title === normalized) {
      return dialog.entity;
    }
  }
  throw new Error(`TG target not found: ${rawTarget}`);
}

async function loadResume(fileUrl) {
  let response;
  try {
    response = await fetchWithRetry(fileUrl);
  } catch (error) {
    throw new Error(`Resume download failed: ${error?.message || 'network error'}`);
  }
  if (!response.ok) throw new Error(`Resume download failed: ${response.status}`);
  const declaredSize = Number(response.headers.get('content-length') || 0);
  if (declaredSize > MAX_FILE_BYTES) throw new Error('Resume exceeds 50MB');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_FILE_BYTES) throw new Error('Resume exceeds 50MB');
  return buffer;
}

async function processRecord(client, dialogs, claim) {
  const { id, record } = claim;
  const deliveries = normalizeDeliveries(record);
  try {
    if (deliveries.length > 0 && record.sent === deliveries.length) {
      await finishClaim(record);
      return;
    }
    if (deliveries.length === 0) {
      record.status = 'failed';
      record.error = 'TG delivery has no items';
      record.finishedAt = new Date().toISOString();
      record.updatedAt = record.finishedAt;
      delete record.lease;
      await finishClaim(record);
      return;
    }

    // Fence the claim before any slow target or resume fetch.
    await saveLeaseRecord(record);
    let entity;
    let buffer;
    try {
      entity = await withLeaseRenewal(record, () => withTimeout(
        resolveTarget(client, record.target, dialogs),
        TG_SETUP_TIMEOUT_MS,
        'Telegram target resolution',
      ));
      buffer = await withLeaseRenewal(record, () => loadResume(record.fileUrl));
    } catch (error) {
      if (error instanceof LeaseLostError || error instanceof DeliveryMappingError || error instanceof FatalOperationTimeoutError) throw error;
      const message = error?.message || 'TG delivery failed';
      for (const delivery of deliveries) {
        if (delivery.status === 'sent') continue;
        delivery.status = 'failed';
        delivery.error = message;
      }
      await finishClaim(record);
      return;
    }

    for (const [deliveryIndex, delivery] of deliveries.entries()) {
      if (delivery.status === 'sent') continue;
      if ((Number(delivery.attempts) || 0) > 0) {
        const existingMessage = await withLeaseRenewal(record, () => withTimeout(
          findDeliveredMessage(client, entity, record, delivery),
          TG_SETUP_TIMEOUT_MS,
          'Telegram delivery reconciliation',
        ));
        if (existingMessage) {
          markDeliveryReconciled(delivery, existingMessage);
          normalizeDeliveries(record);
          await saveLeaseRecord(record);
          continue;
        }
      }
      delivery.status = 'sending';
      delivery.attempts = (Number(delivery.attempts) || 0) + 1;
      delete delivery.error;
      // This checkpoint is the fencing barrier immediately before Telegram I/O.
      await saveLeaseRecord(record);
      await writeHeartbeat();
      try {
        const result = await withLeaseRenewal(record, () => withTimeout(
          sendDelivery(client, entity, id, deliveryIndex, delivery, buffer),
          TG_OPERATION_TIMEOUT_MS,
          'Telegram delivery',
        ));
        delivery.status = 'sent';
        delivery.sentAt = new Date().toISOString();
        const messageId = telegramMessageId(result);
        if (messageId) delivery.messageId = messageId;
        delete delivery.error;
      } catch (error) {
        if (error instanceof LeaseLostError || error instanceof DeliveryMappingError || error instanceof FatalOperationTimeoutError) throw error;
        let existingMessage = null;
        try {
          existingMessage = await withLeaseRenewal(record, () => withTimeout(
            findDeliveredMessage(client, entity, record, delivery),
            TG_SETUP_TIMEOUT_MS,
            'Telegram delivery reconciliation',
          ));
        } catch {
          // Preserve the original send error when Telegram history is temporarily unavailable.
        }
        if (existingMessage) markDeliveryReconciled(delivery, existingMessage);
        else {
          delivery.status = 'failed';
          delivery.error = error?.message || 'TG delivery failed';
        }
      }
      normalizeDeliveries(record);
      // If the lease expired while Telegram was working, this throws and prevents every later send/write.
      await saveLeaseRecord(record);
    }

    await finishClaim(record);
  } catch (error) {
    if (error instanceof LeaseLostError || error instanceof DeliveryMappingError) return;
    throw error;
  }
}

function assertEnv() {
  if (!tgEnv('API_ID') || !tgEnv('API_HASH') || !tgEnv('SESSION')) throw new Error(`Missing TG API env for account ${ACCOUNT}`);
  if (!supabaseConfigured() && (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN)) throw new Error('Missing business storage env');
}

function createClient() {
  const proxy = parseProxy(process.env.TG_PROXY);
  return new TelegramClient(
    new StringSession(tgEnv('SESSION').replace(/\s+/g, '')),
    Number.parseInt(tgEnv('API_ID'), 10),
    tgEnv('API_HASH'),
    { connectionRetries: 3, ...(proxy ? { proxy } : {}) },
  );
}

async function refreshDialogs(client) {
  const dialogs = await client.getDialogs({ limit: 160 });
  await kvSet(DIALOGS_KEY, { updatedAt: new Date().toISOString(), items: dialogItems(dialogs) });
  return dialogs;
}

async function writeHeartbeat() {
  await kvSet(HEARTBEAT_KEY, { at: new Date().toISOString(), workerId: WORKER_ID });
}

async function processBatch(client, dialogs, firstClaim = null) {
  let processed = 0;
  let claim = firstClaim;
  while (processed < MAX_BATCHES) {
    claim ||= await claimNext();
    if (!claim) break;
    await processRecord(client, dialogs, claim);
    processed += 1;
    claim = null;
  }
  if (processed) console.log(JSON.stringify({ processed, at: new Date().toISOString() }));
  return processed;
}

async function runOnce() {
  await recoverStaleClaims();
  const firstClaim = await claimNext();
  const dialogCache = await kvGet(DIALOGS_KEY).catch(() => null);
  const cacheAge = dialogCache?.updatedAt ? Date.now() - new Date(dialogCache.updatedAt).getTime() : Number.POSITIVE_INFINITY;
  if (!firstClaim && cacheAge < DIALOG_REFRESH_MS) return;

  const client = createClient();

  try {
    await withTimeout(client.connect(), TG_SETUP_TIMEOUT_MS, 'Telegram connection');
  } catch (error) {
    if (firstClaim) await releaseClaim(firstClaim).catch(() => {});
    throw error;
  }

  try {
    let dialogs = [];
    try {
      dialogs = await withTimeout(refreshDialogs(client), TG_SETUP_TIMEOUT_MS, 'Telegram dialog refresh');
    } catch (error) {
      console.error(`[tg-delivery] dialog refresh skipped: ${error?.message || error}`);
    }
    await processBatch(client, dialogs, firstClaim);
  } finally {
    await client.disconnect();
  }
}

async function runWatch() {
  await recoverStaleClaims();
  const client = createClient();
  await withTimeout(client.connect(), TG_SETUP_TIMEOUT_MS, 'Telegram connection');
  let dialogs = [];
  try {
    dialogs = await withTimeout(refreshDialogs(client), TG_SETUP_TIMEOUT_MS, 'Telegram dialog refresh');
  } catch (error) {
    console.error(`[tg-delivery] dialog refresh skipped: ${error?.message || error}`);
  }
  await writeHeartbeat();
  let refreshedAt = Date.now();
  let recoveredAt = Date.now();
  let stopping = false;
  const stop = () => { stopping = true; };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  const heartbeatTimer = setInterval(() => {
    writeHeartbeat().catch((error) => console.error(`[tg-delivery] heartbeat: ${error?.message || error}`));
  }, HEARTBEAT_INTERVAL_MS);

  try {
    while (!stopping) {
      try {
        if (Date.now() - refreshedAt >= DIALOG_REFRESH_MS) {
          try {
            dialogs = await withTimeout(refreshDialogs(client), TG_SETUP_TIMEOUT_MS, 'Telegram dialog refresh');
          } catch (error) {
            console.error(`[tg-delivery] dialog refresh skipped: ${error?.message || error}`);
          }
          refreshedAt = Date.now();
        }
        if (Date.now() - recoveredAt >= RECOVERY_INTERVAL_MS) {
          await recoverStaleClaims();
          recoveredAt = Date.now();
        }
        const firstClaim = await claimNext();
        const processed = firstClaim ? await processBatch(client, dialogs, firstClaim) : 0;
        await wait(processed ? 300 : POLL_INTERVAL_MS);
      } catch (error) {
        if (error instanceof FatalOperationTimeoutError) throw error;
        console.error(`[tg-delivery] ${error?.stack || error}`);
        await wait(POLL_INTERVAL_MS);
      }
    }
  } finally {
    clearInterval(heartbeatTimer);
    await client.disconnect().catch(() => {});
  }
}

assertEnv();
const watchMode = process.argv.includes('--watch');
(watchMode ? runWatch() : runOnce()).then(() => {
  process.exit(0);
}).catch((error) => {
  console.error(`[tg-delivery] ${error?.stack || error}`);
  process.exit(1);
});
