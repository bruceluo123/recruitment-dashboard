#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { CustomFile } from 'telegram/client/uploads.js';
import { NewMessage } from 'telegram/events/index.js';

const ROOT = process.cwd();
const ENV_PATH = path.join(ROOT, '.env.local');
const STATE_KEY = 'recruit:tg-robin-intake-state';
const DEFAULT_TARGET = '@bruceluo123';
const REQUIRED_FIELDS = [
  'name',
  'jobTitle',
  'years',
  'currentSalary',
  'expectedSalary',
  'location',
  'availability',
  'videoAccepted',
];

function loadEnv() {
  if (!fs.existsSync(ENV_PATH)) return;
  for (const line of fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
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

function arg(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function clean(value) {
  return String(value || '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim();
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

function field(text, labels) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  for (const line of lines) {
    for (const label of labels) {
      const index = line.indexOf(label);
      if (index === -1) continue;
      const value = clean(line.slice(index + label.length).replace(/^[\s:：-]+/, ''));
      if (value) return value;
    }
  }
  return '';
}

function parseCandidateTemplate(text) {
  const parsed = {
    name: field(text, ['候选人姓名（英文名）', '候选人姓名(英文名)', '候选人姓名']),
    jobTitle: field(text, ['应聘岗位']),
    years: field(text, ['工作年限']),
    currentSalary: field(text, ['当前薪资']),
    expectedSalary: field(text, ['期望薪资']),
    location: field(text, ['目前所在地']),
    availability: field(text, ['预计可到岗时间']),
    videoAccepted: field(text, [
      '面试是否接受开视频（主要为了验证真人和避免AI辅助面试）',
      '面试是否接受开视频(主要为了验证真人和避免AI辅助面试)',
      '面试是否接受开视频',
    ]),
  };
  return REQUIRED_FIELDS.every((key) => parsed[key]) ? parsed : null;
}

function formatCandidateTemplate(candidate) {
  return [
    `候选人姓名（英文名）：${candidate.name}`,
    `应聘岗位：${candidate.jobTitle}`,
    `工作年限：${candidate.years}`,
    `当前薪资：${candidate.currentSalary}`,
    `期望薪资：${candidate.expectedSalary}`,
    `目前所在地：${candidate.location}`,
    `预计可到岗时间：${candidate.availability}`,
    `面试是否接受开视频（主要为了验证真人和避免AI辅助面试）：${candidate.videoAccepted}`,
  ].join('\n');
}

function fileNameOf(message) {
  for (const attr of message.document?.attributes || []) {
    if (attr instanceof Api.DocumentAttributeFilename || attr.className === 'DocumentAttributeFilename') {
      return clean(attr.fileName);
    }
  }
  return clean(message.file?.name);
}

function isPdf(message) {
  const fileName = fileNameOf(message);
  return Boolean(message.document) && (/\.pdf$/i.test(fileName) || message.document?.mimeType === 'application/pdf');
}

function resumePdfScore(message, candidateName) {
  if (!isPdf(message)) return Number.NEGATIVE_INFINITY;
  const fileName = fileNameOf(message).toLowerCase();
  if (/(作品集|portfolio|showcase|测试题|作业|方案|计划|手册|sop|proposal|case study)/i.test(fileName)) return Number.NEGATIVE_INFINITY;
  const normalizedName = clean(candidateName).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/g, '');
  const normalizedFile = fileName.replace(/[^a-z0-9\u4e00-\u9fff]/g, '');
  let score = Number(message.id || 0) / 1_000_000;
  if (/(简历|resume|curriculumvitae|\bcv\b)/i.test(fileName)) score += 100;
  if (normalizedName && normalizedName.length >= 2 && normalizedFile.includes(normalizedName)) score += 80;
  return score;
}

function entityName(entity) {
  return clean([
    entity.firstName,
    entity.lastName,
  ].filter(Boolean).join(' ')) || clean(entity.title) || clean(entity.username) || String(entity.id || '');
}

function entityUsername(entity) {
  return clean(entity?.username).replace(/^@/, '');
}

function isPrivateIncoming(message) {
  return Boolean(message?.isPrivate) && !message?.out;
}

async function kvGet(key) {
  const response = await fetch(`${process.env.KV_REST_API_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
  });
  if (!response.ok) throw new Error(`KV get failed: ${response.status}`);
  return (await response.json()).result;
}

async function kvSet(key, value) {
  const response = await fetch(`${process.env.KV_REST_API_URL}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
      'Content-Type': 'text/plain',
    },
    body: value,
  });
  if (!response.ok) throw new Error(`KV set failed: ${response.status}`);
}

function normalizeState(raw) {
  let parsed = {};
  try { parsed = raw ? JSON.parse(raw) : {}; } catch { parsed = {}; }
  return {
    initializedAt: parsed.initializedAt || '',
    lastScanAt: parsed.lastScanAt || '',
    processed: Array.isArray(parsed.processed) ? parsed.processed : [],
    recentDetected: Array.isArray(parsed.recentDetected) ? parsed.recentDetected : [],
  };
}

async function recordsForChat(client, entity, templates, { messageLimit, cutoff }) {
  if (!entity || entity.bot || entity.self) return { pairs: [], pending: [] };
  const messages = (await client.getMessages(entity, { limit: messageLimit }))
    .filter((message) => Number(message.date || 0) * 1000 >= cutoff);
  const pairs = [];
  const pending = [];
  for (const template of templates) {
    const candidate = parseCandidateTemplate(template.message || '');
    if (!candidate) continue;
    const pdf = messages
      .map((message) => ({ message, score: resumePdfScore(message, candidate.name) }))
      .filter((item) => Number.isFinite(item.score))
      .sort((a, b) => b.score - a.score)[0]?.message || null;
    const record = {
      key: `${String(template.chatId || entity.id)}:${template.id}`,
      chatId: String(template.chatId || entity.id),
      chatName: entityName(entity),
      username: entityUsername(entity),
      templateMessageId: template.id,
      templateDate: new Date(Number(template.date) * 1000).toISOString(),
      candidate,
      pdf,
      pdfMessageId: pdf?.id || null,
      pdfFileName: pdf ? fileNameOf(pdf) : '',
    };
    if (pdf) pairs.push(record);
    else pending.push(record);
  }
  return { pairs, pending };
}

async function collectPrivatePairs(client, { searchLimit, messageLimit, days }) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const found = await client.getMessages(undefined, {
    limit: searchLimit,
    search: '候选人姓名',
  });
  const templates = found.filter((message) => (
    isPrivateIncoming(message)
    && Number(message.date || 0) * 1000 >= cutoff
    && parseCandidateTemplate(message.message || '')
  ));
  const byChat = new Map();
  for (const template of templates) {
    const chatId = String(template.chatId || template.senderId || '');
    if (!chatId) continue;
    if (!byChat.has(chatId)) byChat.set(chatId, []);
    byChat.get(chatId).push(template);
  }

  const pairs = [];
  const pending = [];
  for (const chatTemplates of byChat.values()) {
    const entity = await chatTemplates[0].getChat();
    const result = await recordsForChat(client, entity, chatTemplates, { messageLimit, cutoff });
    pairs.push(...result.pairs);
    pending.push(...result.pending);
  }
  return { pairs, pending, privateDialogCount: byChat.size };
}

async function sendPair(client, target, pair) {
  const caption = formatCandidateTemplate(pair.candidate);
  try {
    await client.sendFile(target, {
      file: pair.pdf.media,
      caption,
      forceDocument: true,
    });
  } catch (error) {
    const buffer = await client.downloadMedia(pair.pdf, {});
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw error;
    await client.sendFile(target, {
      file: new CustomFile(pair.pdfFileName || 'resume.pdf', buffer.length, '', buffer),
      caption,
      forceDocument: true,
    });
  }
}

async function sendRobinFollowup(client, target, pair) {
  await client.sendMessage(target, {
    message: `这个人我刚沟通过，${pair.candidate.years}经验，资料也比较完整，你帮忙看看能不能推进一下。合适的话我再去确认面试时间。`,
  });
}

async function sendMmfReplyToRobin(robin, pair) {
  const apiId = process.env.TG_API_ID || '';
  const apiHash = process.env.TG_API_HASH || '';
  const session = process.env.TG_SESSION || '';
  if (!apiId || !apiHash || !session) throw new Error('Missing MMF Telegram account environment.');

  const client = new TelegramClient(
    new StringSession(session.replace(/\s+/g, '')),
    Number.parseInt(apiId, 10),
    apiHash,
    { connectionRetries: 3, ...(process.env.TG_PROXY ? { proxy: parseProxy(process.env.TG_PROXY) } : {}) },
  );
  await client.connect();
  try {
    const robinId = String(robin.id || '');
    const robinUsername = clean(robin.username).replace(/^@/, '').toLowerCase();
    const dialog = (await client.getDialogs({ limit: 200 })).find((item) => {
      const entity = item.entity || {};
      return String(entity.id || '') === robinId
        || (robinUsername && clean(entity.username).replace(/^@/, '').toLowerCase() === robinUsername);
    });
    const target = dialog?.entity || (robinUsername ? await client.getInputEntity(`@${robinUsername}`) : null);
    if (!target) throw new Error('MMF cannot resolve the Robin private chat.');
    await client.sendMessage(target, { message: '收到，我先看一下简历。' });
    await client.sendMessage(target, {
      message: `${pair.candidate.jobTitle}这边我会优先对一下合适岗位，有结果跟你说。`,
    });
  } finally {
    await client.disconnect();
  }
}

async function sendConversation(client, target, robin, pair) {
  await sendPair(client, target, pair);
  await sendRobinFollowup(client, target, pair);
  await sendMmfReplyToRobin(robin, pair);
}

async function persistState(state) {
  state.processed = state.processed.slice(-4000);
  state.recentDetected = state.recentDetected.slice(-200);
  state.lastScanAt = new Date().toISOString();
  await kvSet(STATE_KEY, JSON.stringify(state));
}

function scanSummary(result, processedSet) {
  const records = [...result.pairs, ...result.pending]
    .sort((a, b) => b.templateDate.localeCompare(a.templateDate))
    .map((item) => ({
      sender: item.chatName,
      username: item.username ? `@${item.username}` : '',
      candidate: item.candidate.name,
      jobTitle: item.candidate.jobTitle,
      templateDate: item.templateDate,
      pdf: item.pdfFileName || '等待 PDF',
      status: item.pdf ? (processedSet.has(item.key) ? '已处理' : '可转发') : '等待 PDF',
    }));
  return {
    privateDialogs: result.privateDialogCount,
    filledTemplates: records.length,
    ready: result.pairs.length,
    pendingPdf: result.pending.length,
    records,
  };
}

async function main() {
  loadEnv();
  const apiId = process.env.TG_ROBIN_API_ID || '';
  const apiHash = process.env.TG_ROBIN_API_HASH || '';
  const session = process.env.TG_ROBIN_SESSION || '';
  const targetName = process.env.ROBIN_FORWARD_TARGET || DEFAULT_TARGET;
  const scanOnly = hasFlag('--scan');
  const watch = hasFlag('--watch');
  const sendCandidate = clean(arg('--send-candidate', ''));
  const days = Number.parseInt(arg('--days', scanOnly ? '14' : '7'), 10);
  const searchLimit = Number.parseInt(arg('--search-limit', '300'), 10);
  const messageLimit = Number.parseInt(arg('--message-limit', '80'), 10);

  if (!scanOnly && !watch && !sendCandidate) throw new Error('Pass --scan, --watch or --send-candidate.');
  if (!apiId || !apiHash || !session) throw new Error('Missing TG_ROBIN_API_ID, TG_ROBIN_API_HASH or TG_ROBIN_SESSION.');
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) throw new Error('Missing KV environment.');

  const client = new TelegramClient(
    new StringSession(session.replace(/\s+/g, '')),
    Number.parseInt(apiId, 10),
    apiHash,
    { connectionRetries: 3, ...(process.env.TG_PROXY ? { proxy: parseProxy(process.env.TG_PROXY) } : {}) },
  );
  await client.connect();

  const me = await client.getMe();
  if (!me) throw new Error('Robin Telegram session is not authenticated.');
  const state = normalizeState(await kvGet(STATE_KEY).catch(() => ''));
  const processedSet = new Set(state.processed);

  if (sendCandidate) {
    try {
      const result = await collectPrivatePairs(client, { searchLimit, messageLimit, days });
      const query = sendCandidate.toLowerCase();
      const pair = result.pairs
        .filter((item) => item.candidate.name.toLowerCase() === query || item.chatName.toLowerCase().includes(query))
        .sort((a, b) => b.templateDate.localeCompare(a.templateDate))[0];
      if (!pair) throw new Error(`No complete candidate and resume PDF found for: ${sendCandidate}`);
      const target = await client.getInputEntity(targetName);
      await sendConversation(client, target, me, pair);
      processedSet.add(pair.key);
      state.processed = [...processedSet];
      state.recentDetected.push({
        sender: pair.chatName,
        username: pair.username ? `@${pair.username}` : '',
        candidate: pair.candidate.name,
        jobTitle: pair.candidate.jobTitle,
        templateDate: pair.templateDate,
        pdf: pair.pdfFileName,
        status: '已手动转发',
        forwardedAt: new Date().toISOString(),
      });
      await persistState(state);
      console.log(`[manual forwarded] ${pair.chatName} / ${pair.candidate.name} / ${pair.pdfFileName}`);
    } finally {
      await client.disconnect();
    }
    return;
  }

  if (scanOnly) {
    try {
      const result = await collectPrivatePairs(client, { searchLimit, messageLimit, days });
      console.log(JSON.stringify(scanSummary(result, processedSet), null, 2));
    } finally {
      await client.disconnect();
    }
    return;
  }

  const target = await client.getInputEntity(targetName);
  const forwardPairs = async (result) => {
    for (const pair of result.pairs.sort((a, b) => a.templateDate.localeCompare(b.templateDate))) {
      if (processedSet.has(pair.key)) continue;
      await sendConversation(client, target, me, pair);
      processedSet.add(pair.key);
      state.processed = [...processedSet];
      state.recentDetected.push({
        sender: pair.chatName,
        username: pair.username ? `@${pair.username}` : '',
        candidate: pair.candidate.name,
        jobTitle: pair.candidate.jobTitle,
        templateDate: pair.templateDate,
        pdf: pair.pdfFileName,
        status: '已转发',
        forwardedAt: new Date().toISOString(),
      });
      await persistState(state);
      console.log(`[forwarded] ${pair.chatName} / ${pair.candidate.name} / ${pair.pdfFileName}`);
    }
  };

  const initial = await collectPrivatePairs(client, { searchLimit, messageLimit, days });
  if (!state.initializedAt) {
    for (const pair of initial.pairs) processedSet.add(pair.key);
    state.processed = [...processedSet];
    state.initializedAt = new Date().toISOString();
    state.recentDetected = scanSummary(initial, processedSet).records;
    await persistState(state);
    console.log(`[baseline] ${initial.pairs.length} existing pairs recorded; future messages will be forwarded.`);
  } else {
    await forwardPairs(initial);
  }

  let eventQueue = Promise.resolve();
  client.addEventHandler((event) => {
    eventQueue = eventQueue.then(async () => {
      const message = event.message;
      if (!isPrivateIncoming(message)) return;
      if (!parseCandidateTemplate(message.message || '') && !isPdf(message)) return;
      const entity = await message.getChat();
      if (!entity || entity.bot || entity.self) return;
      const history = await client.getMessages(entity, { limit: messageLimit });
      const templates = history.filter((item) => (
        isPrivateIncoming(item)
        && parseCandidateTemplate(item.message || '')
      ));
      const result = await recordsForChat(client, entity, templates, {
        messageLimit,
        cutoff: Date.now() - days * 24 * 60 * 60 * 1000,
      });
      await forwardPairs(result);
    }).catch((error) => console.error(`[event failed] ${error?.message || error}`));
  }, new NewMessage({ incoming: true }));

  console.log(`[watching] Robin private chat events -> ${targetName}`);
  const heartbeat = setInterval(() => console.log(`[heartbeat] ${new Date().toISOString()}`), 5 * 60 * 1000);
  const shutdown = async () => {
    clearInterval(heartbeat);
    await client.disconnect().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
