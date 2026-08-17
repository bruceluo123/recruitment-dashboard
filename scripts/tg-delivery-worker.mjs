#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { CustomFile } from 'telegram/client/uploads.js';

const ROOT = process.cwd();
const QUEUE_KEY = 'recruit:tg-delivery-pending';
const DIALOGS_KEY = 'recruit:tg-delivery-dialogs';
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_BATCHES = 10;

function loadEnv() {
  const envPath = path.join(ROOT, '.env.local');
  if (!fs.existsSync(envPath)) return;
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

function parseStored(value) {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}

async function kvCommand(command, ...args) {
  const url = `${process.env.KV_REST_API_URL}/${command}/${args.map((value) => encodeURIComponent(value)).join('/')}`;
  const response = await fetch(url, { headers: kvHeaders() });
  if (!response.ok) throw new Error(`KV ${command} failed: ${response.status}`);
  return parseStored((await response.json()).result);
}

async function kvGet(key) {
  return kvCommand('get', key);
}

async function kvSet(key, value) {
  const response = await fetch(`${process.env.KV_REST_API_URL}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: kvHeaders('application/json'),
    body: JSON.stringify(value),
  });
  if (!response.ok) throw new Error(`KV set failed: ${response.status}`);
}

async function kvRPush(key, value) {
  return kvCommand('rpush', key, value);
}

async function kvLPop(key) {
  return kvCommand('lpop', key);
}

async function kvExpire(key, seconds) {
  return kvCommand('expire', key, String(seconds));
}

function recordKey(id) {
  return `recruit:tg-delivery:${id}`;
}

async function saveRecord(record) {
  await kvSet(recordKey(record.id), record);
  await kvExpire(recordKey(record.id), 7 * 24 * 60 * 60).catch(() => {});
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
  const response = await fetch(fileUrl);
  if (!response.ok) throw new Error(`Resume download failed: ${response.status}`);
  const declaredSize = Number(response.headers.get('content-length') || 0);
  if (declaredSize > MAX_FILE_BYTES) throw new Error('Resume exceeds 50MB');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_FILE_BYTES) throw new Error('Resume exceeds 50MB');
  return buffer;
}

async function processRecord(client, dialogs, id) {
  const record = await kvGet(recordKey(id));
  if (!record || record.status !== 'queued') return;
  record.status = 'sending';
  await saveRecord(record);
  try {
    const entity = await resolveTarget(client, record.target, dialogs);
    const buffer = await loadResume(record.fileUrl);
    let sent = 0;
    for (const delivery of record.deliveries || []) {
      await client.sendFile(entity, {
        file: new CustomFile(delivery.fileName, buffer.length, '', buffer),
        caption: String(delivery.text || '').slice(0, 1000),
        forceDocument: true,
        parseMode: false,
        workers: 1,
      });
      sent += 1;
    }
    record.status = 'sent';
    record.sent = sent;
    record.finishedAt = new Date().toISOString();
    delete record.error;
  } catch (error) {
    record.status = 'failed';
    record.error = error?.message || 'TG delivery failed';
    record.finishedAt = new Date().toISOString();
  }
  await saveRecord(record);
}

async function main() {
  loadEnv();
  if (!process.env.TG_API_ID || !process.env.TG_API_HASH || !process.env.TG_SESSION) throw new Error('Missing TG API env');
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) throw new Error('Missing KV env');

  const firstId = await kvLPop(QUEUE_KEY);
  const dialogCache = await kvGet(DIALOGS_KEY).catch(() => null);
  const cacheAge = dialogCache?.updatedAt ? Date.now() - new Date(dialogCache.updatedAt).getTime() : Number.POSITIVE_INFINITY;
  if (!firstId && cacheAge < 15 * 60 * 1000) return;

  const proxy = parseProxy(process.env.TG_PROXY);
  const client = new TelegramClient(
    new StringSession((process.env.TG_SESSION || '').replace(/\s+/g, '')),
    Number.parseInt(process.env.TG_API_ID || '', 10),
    process.env.TG_API_HASH || '',
    { connectionRetries: 3, ...(proxy ? { proxy } : {}) },
  );

  try {
    await client.connect();
  } catch (error) {
    if (firstId) await kvRPush(QUEUE_KEY, firstId).catch(() => {});
    throw error;
  }

  try {
    const dialogs = await client.getDialogs({ limit: 160 });
    await kvSet(DIALOGS_KEY, { updatedAt: new Date().toISOString(), items: dialogItems(dialogs) });

    const ids = firstId ? [firstId] : [];
    while (ids.length < MAX_BATCHES) {
      const nextId = await kvLPop(QUEUE_KEY);
      if (!nextId) break;
      ids.push(nextId);
    }
    for (const id of ids) await processRecord(client, dialogs, id);
    if (ids.length) console.log(JSON.stringify({ processed: ids.length, at: new Date().toISOString() }));
  } finally {
    await client.disconnect();
  }
}

main().catch((error) => {
  console.error(`[tg-delivery] ${error?.stack || error}`);
  process.exitCode = 1;
});

