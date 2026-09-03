#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';

const ROOT = process.cwd();
const ENV_PATH = path.join(ROOT, '.env.local');
const PROMPT_VERSION = 'feedback-audit-v1';
const VISION_MODEL = 'deepseek-v4-flash-vision-exp';

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
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
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

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function parseStored(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return fallback; }
  }
  return value;
}

function normalize(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '');
}

function normalizeName(value) {
  return normalize(String(value || '').split(/[-—–_|]/)[0]);
}

function normalizeCode(value) {
  const match = String(value || '').match(/XY(?:MMF|BB)\d+/i);
  return match ? match[0].toUpperCase() : '';
}

function shanghaiDateKey(date) {
  return new Date(date.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function shanghaiDateTime(date) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date).replaceAll('/', '-');
}

function toDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function jobTokens(value) {
  const normalized = normalize(value)
    .replace(/工程师|负责人|专家|经理|专员|主管|高级|中级|初级|资深|开发|方向|岗位/g, ' ');
  const words = clean(value).toLowerCase().match(/[a-z][a-z0-9+#.]{1,}|[\u4e00-\u9fa5]{2,}/g) || [];
  const chunks = normalized.match(/[a-z0-9+#.]{2,}|[\u4e00-\u9fa5]{2,4}/g) || [];
  return new Set([...words, ...chunks].filter((word) => word.length >= 2));
}

function jobSimilarity(a, b) {
  const left = jobTokens(a);
  const right = jobTokens(b);
  if (!left.size || !right.size) return 0;
  let hits = 0;
  for (const token of left) {
    if ([...right].some((item) => item === token || item.includes(token) || token.includes(item))) hits += 1;
  }
  return hits / Math.max(1, Math.min(left.size, right.size));
}

const ORGANIZATION_ALIAS_GROUPS = [
  ['极乐引擎', '极乐'],
  ['瑞升公司', '瑞升'],
  ['紫宸星宇', '紫宸'],
  ['万有引力'],
  ['悦达'],
  ['无极'],
  ['鼎丰'],
  ['经纬'],
  ['happy'],
  ['odc'],
];

function organizationTokens(value) {
  const normalized = normalize(value);
  const tokens = new Set(normalized ? [normalized] : []);
  for (const aliases of ORGANIZATION_ALIAS_GROUPS) {
    if (aliases.some((alias) => normalized.includes(normalize(alias)))) tokens.add(normalize(aliases[0]));
  }
  return tokens;
}

function organizationSimilarity(a, b) {
  const left = organizationTokens(a);
  const right = organizationTokens(b);
  if (!left.size || !right.size) return 0;
  for (const token of left) {
    if (right.has(token)) return 1;
  }
  for (const token of left) {
    if ([...right].some((item) => item.includes(token) || token.includes(item))) return 0.5;
  }
  return 0;
}

function screenshotJobTitle(rawText, candidateName) {
  const raw = String(rawText || '');
  const escapedName = clean(candidateName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (escapedName) {
    const namedFile = raw.match(new RegExp(`${escapedName}\\s*[-_—–]\\s*([^,，。\\n]{1,100}?)\\.(?:pdf|docx?)`, 'i'));
    if (namedFile?.[1]) return clean(namedFile[1]);
  }
  const file = raw.match(/([^,，。\n]{2,120}?)\.(?:pdf|docx?)/i)?.[1];
  if (!file) return '';
  const parts = file.split(/[-_—–]/).map(clean).filter(Boolean);
  return parts.length > 1 ? clean(parts.slice(1).join(' ')) : '';
}

function normalizedFeedbackResult(item, rawText) {
  if (item.result === 'failed' || item.result === 'passed') return item.result;
  const text = `${item.interviewStage} ${item.feedbackSummary} ${item.evidence} ${rawText}`;
  if (/(辛苦约|约面|安排.{0,8}面试|面试.{0,8}(安排|时间)|约.{0,12}(今天|明天|上午|下午|晚上|\d{1,2}\s*[:：]\s*\d{2}))/i.test(text)) {
    return 'scheduled';
  }
  return item.result;
}

async function kvGet(key) {
  const response = await fetch(`${process.env.KV_REST_API_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
  });
  if (!response.ok) throw new Error(`KV get ${key} failed: ${response.status}`);
  return (await response.json()).result;
}

async function kvSet(key, value) {
  const response = await fetch(`${process.env.KV_REST_API_URL}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
      'Content-Type': 'text/plain; charset=utf-8',
    },
    body: typeof value === 'string' ? value : JSON.stringify(value),
  });
  if (!response.ok) throw new Error(`KV set ${key} failed: ${response.status}`);
  return true;
}

function isImageMessage(message) {
  if (message.photo) return true;
  const mime = clean(message.document?.mimeType || message.file?.mimeType).toLowerCase();
  return /^image\/(jpeg|jpg|png|webp)$/.test(mime);
}

function imageExtension(message) {
  const mime = clean(message.document?.mimeType || message.file?.mimeType).toLowerCase();
  if (mime.includes('png')) return '.png';
  if (mime.includes('webp')) return '.webp';
  return '.jpg';
}

function messageDate(message) {
  return new Date(Number(message.date || 0) * 1000);
}

function contextFor(messages, index, accountLabel) {
  const current = messages[index];
  const currentTime = messageDate(current).getTime();
  return messages
    .slice(Math.max(0, index - 3), Math.min(messages.length, index + 4))
    .filter((message) => {
      const text = clean(message.message);
      return text && Math.abs(messageDate(message).getTime() - currentTime) <= 30 * 60 * 1000;
    })
    .map((message) => `${message.out ? accountLabel : 'ojisamer'} ${shanghaiDateTime(messageDate(message))}: ${clean(message.message)}`)
    .join('\n');
}

function extractJson(text) {
  const raw = String(text || '').trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced || raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
  if (!candidate) throw new Error('Vision response did not contain JSON');
  return JSON.parse(candidate);
}

function sanitizeVisionResult(value) {
  const allowed = new Set(['passed', 'failed', 'scheduled', 'pending', 'no_feedback', 'other', 'unknown']);
  const items = Array.isArray(value?.items) ? value.items : [];
  return {
    screenType: clean(value?.screenType || 'other'),
    rawText: clean(value?.rawText),
    items: items.map((item) => {
      const result = allowed.has(item?.result) ? item.result : 'unknown';
      return {
        candidateCode: normalizeCode(item?.candidateCode),
        candidateName: clean(item?.candidateName),
        jobTitle: clean(item?.jobTitle),
        organization: clean(item?.organization),
        interviewStage: clean(item?.interviewStage),
        result,
        feedbackSummary: clean(item?.feedbackSummary),
        evidence: clean(item?.evidence),
        confidence: Math.max(0, Math.min(1, Number(item?.confidence) || 0)),
      };
    }),
  };
}

async function recognizeScreenshot(buffer, extension, context) {
  const mime = extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : 'image/jpeg';
  const prompt = `你是招聘反馈截图审计助手。识别截图中的候选人、岗位、部门或服务单位、面试轮次和明确反馈，并结合聊天上下文辅助定位。\n\n规则：\n1. 只有截图中明确出现“未通过、不通过、不合适、淘汰、拒绝、不推进、面试失败”等否定结论，且能明确归属到候选人时，result 才能是 failed。\n2. “待反馈、还没反馈、催一下、暂无消息”是 pending，绝不能当作 failed。\n3. 截图明确出现约面或面试时间安排时，result 使用 scheduled；没有任何结论或排期时才用 unknown。\n4. 优先从转发文件名中的“候选人-岗位.pdf”识别姓名和岗位，不要用相似岗位替换文件名里的岗位。\n5. 保留截图中出现的部门、服务单位及简称，例如“极乐”与“极乐引擎”，不要自行改成其他单位。\n6. 一张截图可能有多个人，逐条输出。候选人编码、姓名、岗位看不清就留空。\n7. evidence 只写截图中支持结论的短句，confidence 为 0 到 1。\n8. 仅返回 JSON，不要 Markdown。\n\nJSON 格式：\n{"screenType":"feedback|schedule|recommendation|chat|other","rawText":"截图全文摘要","items":[{"candidateCode":"","candidateName":"","jobTitle":"","organization":"","interviewStage":"","result":"passed|failed|scheduled|pending|no_feedback|other|unknown","feedbackSummary":"","evidence":"","confidence":0.0}]}\n\n聊天上下文：\n${context || '无'}`;
  const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: VISION_MODEL,
      temperature: 0,
      thinking: { type: 'disabled' },
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${mime};base64,${buffer.toString('base64')}` } },
        ],
      }],
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`DeepSeek vision failed: ${response.status} ${clean(body?.error?.message)}`);
  return sanitizeVisionResult(extractJson(body?.choices?.[0]?.message?.content));
}

async function runPool(tasks, concurrency) {
  const results = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const index = next++;
      try { results[index] = await tasks[index](); }
      catch (error) { results[index] = { error: clean(error?.message || error) }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return results;
}

function recommendationDate(item) {
  return toDate(item.uploadedAt || item.updatedAt || item.createdAt);
}

function dedupeRecommendations(items) {
  const map = new Map();
  for (const item of items) {
    const key = `${normalizeCode(item.candidateCode) || normalizeName(item.candidateName)}|${normalize(item.jdTitle)}`;
    const previous = map.get(key);
    if (!previous || (recommendationDate(item)?.getTime() || 0) > (recommendationDate(previous)?.getTime() || 0)) map.set(key, item);
  }
  return [...map.values()];
}

function matchFeedback(item, recommendations, rawText = '') {
  const fileJobTitle = screenshotJobTitle(rawText, item.candidateName);
  const effectiveJobTitle = fileJobTitle || item.jobTitle;
  const rankMatches = (matches) => matches
    .map((rec) => {
      const job = jobSimilarity(effectiveJobTitle, rec.jdTitle);
      const organization = Math.max(
        organizationSimilarity(item.organization, `${rec.organization} ${rec.department}`),
        organizationSimilarity(rawText, `${rec.organization} ${rec.department}`),
      );
      return { rec, job, organization, rank: job * 0.8 + organization * 0.2 };
    })
    .sort((a, b) => b.rank - a.rank
      || b.organization - a.organization
      || b.job - a.job
      || (recommendationDate(b.rec)?.getTime() || 0) - (recommendationDate(a.rec)?.getTime() || 0)
      || clean(a.rec.id).localeCompare(clean(b.rec.id)));
  const code = normalizeCode(item.candidateCode);
  if (code) {
    const codeMatches = recommendations.filter((rec) => normalizeCode(rec.candidateCode) === code);
    if (codeMatches.length === 1) return { recommendation: codeMatches[0], score: 1, reason: '候选人编码一致' };
    if (codeMatches.length > 1) {
      const ranked = rankMatches(codeMatches);
      if (ranked[0].job > 0 || ranked[0].organization > 0 || !effectiveJobTitle) {
        return { recommendation: ranked[0].rec, score: 0.98, reason: fileJobTitle ? '候选人编码一致，按截图文件名及单位匹配' : '候选人编码一致，按岗位及单位匹配' };
      }
    }
  }
  const name = normalizeName(item.candidateName);
  if (!name) return null;
  const candidates = rankMatches(recommendations.filter((rec) => normalizeName(rec.candidateName) === name));
  if (!candidates.length) return null;
  if (candidates.length === 1) {
    return { recommendation: candidates[0].rec, score: Math.min(0.99, effectiveJobTitle ? 0.78 + candidates[0].job * 0.14 + candidates[0].organization * 0.08 : 0.78), reason: '候选人姓名一致' };
  }
  if (candidates[0].rank > candidates[1].rank && (candidates[0].job >= 0.3 || candidates[0].organization > 0)) {
    return {
      recommendation: candidates[0].rec,
      score: Math.min(0.99, 0.78 + candidates[0].job * 0.14 + candidates[0].organization * 0.08),
      reason: fileJobTitle ? '候选人姓名、截图文件名及单位相符' : '候选人姓名、岗位及单位相符',
    };
  }
  return { ambiguous: candidates.map((candidate) => candidate.rec), score: 0.5, reason: '同名多岗位，无法唯一确认' };
}

function findCandidateForRecommendation(rec, candidates) {
  if (rec.candidateId) {
    const linked = candidates.find((candidate) => candidate.id === rec.candidateId);
    if (linked) return linked;
  }
  const recCode = normalizeCode(rec.candidateCode);
  const recName = normalizeName(rec.candidateName);
  return candidates.find((candidate) => {
    if (recCode && normalizeCode(candidate.candidateCode) === recCode) return true;
    return recName && normalizeName(candidate.name) === recName && jobSimilarity(rec.jdTitle, candidate.jdTitle) >= 0.2;
  });
}

function reportRow(rec, extra = {}) {
  return {
    recommendationId: clean(rec.id),
    candidateCode: normalizeCode(rec.candidateCode),
    candidateName: clean(rec.candidateName),
    jobTitle: clean(rec.jdTitle),
    organization: clean(rec.organization),
    department: clean(rec.department),
    recommendedAt: recommendationDate(rec) ? shanghaiDateTime(recommendationDate(rec)) : '',
    interviewStatus: rec.interviewStatus === 'scheduled' ? '已约面' : '未约面',
    contact: clean(rec.contact),
    ...extra,
  };
}

function feedbackInboxId(row, sourceStatus, index, owner) {
  if (clean(row.recommendationId)) return clean(row.recommendationId);
  if (clean(row.telegramMessageId || row.messageId)) {
    return `${owner}:${sourceStatus}:tg:${clean(row.telegramMessageId || row.messageId)}`;
  }
  return [
    owner,
    sourceStatus,
    normalizeCode(row.candidateCode),
    normalizeName(row.candidateName),
    normalize(row.jobTitle),
    index,
  ].filter(Boolean).join(':');
}

function toFeedbackInboxItem(row, sourceStatus, index, generatedAt, owner) {
  return {
    id: feedbackInboxId(row, sourceStatus, index, owner),
    recommendationId: clean(row.recommendationId) || undefined,
    owner,
    candidateCode: normalizeCode(row.candidateCode) || undefined,
    candidateName: clean(row.candidateName),
    jobTitle: clean(row.jobTitle),
    organization: clean(row.organization) || undefined,
    department: clean(row.department) || undefined,
    contactPerson: clean(row.contact) || undefined,
    recommendedAt: clean(row.recommendedAt) || undefined,
    interviewStatus: clean(row.interviewStatus) || undefined,
    feedbackAt: clean(row.feedbackAt) || undefined,
    sourceStatus,
    sourceSummary: clean(row.feedbackSummary || row.rawText || row.reason) || undefined,
    sourceEvidence: clean(row.evidence) || undefined,
    auditConclusion: clean(row.auditConclusion || row.reason) || undefined,
    confidence: Number.isFinite(Number(row.confidence)) ? Number(row.confidence) : undefined,
    telegramMessageId: clean(row.telegramMessageId || row.messageId) || undefined,
    followUpCount: 0,
    timeline: [],
    updatedAt: generatedAt,
  };
}

async function syncFeedbackInbox(owner, meta, noFeedback, scheduledFeedback, interviewFailed, screeningFailed, review) {
  const key = 'recruit:feedback-inbox';
  const generatedAt = meta.generatedAt;
  const imported = [
    ...noFeedback.map((row, index) => toFeedbackInboxItem(
      row,
      row.latestStatus === '待反馈' ? 'pending' : 'no_feedback',
      index,
      generatedAt,
      owner,
    )),
    ...scheduledFeedback.map((row, index) => toFeedbackInboxItem(row, 'scheduled', index, generatedAt, owner)),
    ...interviewFailed.map((row, index) => toFeedbackInboxItem(row, 'interview_failed', index, generatedAt, owner)),
    ...screeningFailed.map((row, index) => toFeedbackInboxItem(row, 'screening_failed', index, generatedAt, owner)),
    ...review.map((row, index) => toFeedbackInboxItem(row, 'manual_review', index, generatedAt, owner)),
  ];
  const existing = parseStored(await kvGet(key), { version: 1, generatedAt: '', items: [] });
  const existingItems = Array.isArray(existing?.items) ? existing.items : [];
  const existingById = new Map(existingItems.map((item) => [
    `${item.owner === 'b' ? 'b' : 'a'}:${clean(item.id)}`,
    item,
  ]));
  const importedIds = new Set(imported.map((item) => item.id));
  const items = imported.map((item) => {
    const previous = existingById.get(`${owner}:${item.id}`);
    if (!previous) return item;
    return {
      ...item,
      confirmedStatus: item.sourceStatus === 'scheduled' && previous.confirmedStatus === 'pending'
        ? undefined
        : previous.confirmedStatus,
      followUpCount: Number(previous.followUpCount) || 0,
      lastFollowUpAt: previous.lastFollowUpAt,
      repushReady: previous.repushReady,
      timeline: Array.isArray(previous.timeline) ? previous.timeline.slice(-30) : [],
      updatedAt: item.sourceStatus === 'scheduled' ? item.updatedAt : previous.updatedAt || item.updatedAt,
    };
  });
  for (const previous of existingItems) {
    const previousOwner = previous.owner === 'b' ? 'b' : 'a';
    if (previousOwner !== owner) {
      items.push(previous);
      continue;
    }
    const hasUserWork = previous.confirmedStatus
      || Number(previous.followUpCount) > 0
      || previous.repushReady
      || (Array.isArray(previous.timeline) && previous.timeline.length > 0);
    if (!importedIds.has(clean(previous.id)) && hasUserWork) items.push(previous);
  }
  await kvSet(key, { version: 1, generatedAt, items });
  return items.length;
}

function styleSheet(sheet, widths) {
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: widths.length } };
  sheet.getRow(1).height = 28;
  sheet.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF334155' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });
  widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    row.alignment = { vertical: 'top', wrapText: true };
  });
}

function addRowsSheet(workbook, name, columns, rows, color) {
  const sheet = workbook.addWorksheet(name);
  sheet.columns = columns.map((column) => ({ header: column.header, key: column.key }));
  for (const row of rows) sheet.addRow(row);
  styleSheet(sheet, columns.map((column) => column.width || 16));
  if (color) {
    for (let row = 2; row <= sheet.rowCount; row += 1) {
      sheet.getCell(row, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
    }
  }
  return sheet;
}

async function writeReport(outputDir, meta, noFeedback, interviewFailed, screeningFailed, review, screenshots) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = '企鹅岛';
  const common = [
    { header: '候选人编码', key: 'candidateCode', width: 16 },
    { header: '候选人', key: 'candidateName', width: 18 },
    { header: '原推荐岗位', key: 'jobTitle', width: 34 },
    { header: '编制组织', key: 'organization', width: 18 },
    { header: '部门', key: 'department', width: 18 },
    { header: '推荐时间', key: 'recommendedAt', width: 20 },
    { header: '约面状态', key: 'interviewStatus', width: 12 },
    { header: '联系方式', key: 'contact', width: 20 },
  ];
  addRowsSheet(workbook, '无反馈待复推', [
    ...common,
    { header: '最近状态时间', key: 'feedbackAt', width: 20 },
    { header: '最近状态', key: 'latestStatus', width: 16 },
    { header: '状态摘要', key: 'feedbackSummary', width: 38 },
    { header: '审计结论', key: 'auditConclusion', width: 28 },
    { header: '本地截图', key: 'imagePath', width: 46 },
  ], noFeedback, 'FFFFF7ED');
  addRowsSheet(workbook, '面试未通过待复推', [
    ...common,
    { header: '面试轮次', key: 'interviewStage', width: 12 },
    { header: '反馈时间', key: 'feedbackAt', width: 20 },
    { header: '反馈摘要', key: 'feedbackSummary', width: 42 },
    { header: '截图证据', key: 'evidence', width: 42 },
    { header: '识别置信度', key: 'confidence', width: 14 },
    { header: '本地截图', key: 'imagePath', width: 46 },
  ], interviewFailed, 'FFFEE2E2');
  addRowsSheet(workbook, '初筛未通过参考', [
    ...common,
    { header: '反馈时间', key: 'feedbackAt', width: 20 },
    { header: '反馈摘要', key: 'feedbackSummary', width: 42 },
    { header: '截图证据', key: 'evidence', width: 42 },
    { header: '识别置信度', key: 'confidence', width: 14 },
    { header: '本地截图', key: 'imagePath', width: 46 },
  ], screeningFailed, 'FFFFF7ED');
  addRowsSheet(workbook, '待人工确认', [
    { header: '反馈时间', key: 'feedbackAt', width: 20 },
    { header: '候选人编码', key: 'candidateCode', width: 16 },
    { header: '候选人', key: 'candidateName', width: 18 },
    { header: '截图岗位', key: 'jobTitle', width: 32 },
    { header: '识别结果', key: 'result', width: 14 },
    { header: '原因', key: 'reason', width: 38 },
    { header: '证据', key: 'evidence', width: 42 },
    { header: '置信度', key: 'confidence', width: 12 },
    { header: '本地截图', key: 'imagePath', width: 46 },
  ], review, 'FFFFFBEB');
  addRowsSheet(workbook, '截图识别明细', [
    { header: '消息ID', key: 'messageId', width: 14 },
    { header: '截图时间', key: 'feedbackAt', width: 20 },
    { header: '截图类型', key: 'screenType', width: 16 },
    { header: '候选人编码', key: 'candidateCode', width: 16 },
    { header: '候选人', key: 'candidateName', width: 18 },
    { header: '岗位', key: 'jobTitle', width: 32 },
    { header: '轮次', key: 'interviewStage', width: 12 },
    { header: '结果', key: 'result', width: 14 },
    { header: '反馈摘要', key: 'feedbackSummary', width: 40 },
    { header: '证据', key: 'evidence', width: 40 },
    { header: '置信度', key: 'confidence', width: 12 },
    { header: '识别全文', key: 'rawText', width: 60 },
    { header: '本地截图', key: 'imagePath', width: 46 },
    { header: '错误', key: 'error', width: 36 },
  ], screenshots);
  const summary = workbook.addWorksheet('审计说明');
  summary.addRows([
    ['项目', '内容'],
    ['审计时间范围', `${meta.from} 至 ${meta.to}`],
    ['聊天对象', '@ojisamer'],
    ['推荐记录范围', `${meta.accountLabel}近 ${meta.days} 天推荐记录（同候选人同岗位去重）`],
    ['截图数', meta.screenshotCount],
    ['无反馈待复推', noFeedback.length],
    ['明确面试未通过', interviewFailed.length],
    ['明确初筛未通过', screeningFailed.length],
    ['待人工确认', review.length],
    ['判定规则', '沉默只归为无反馈；只有截图或面试日历存在明确否定结论才归为未通过。'],
    ['同步说明', 'OCR 结果同步到反馈中心；人工确认、跟进和复推记录优先，巡查不会覆盖人工操作。'],
  ]);
  styleSheet(summary, [24, 80]);
  const filePath = path.join(outputDir, '复推反馈审计.xlsx');
  try {
    await workbook.xlsx.writeFile(filePath);
    return filePath;
  } catch (error) {
    if (error?.code !== 'EBUSY') throw error;
    const fallbackPath = path.join(outputDir, `复推反馈审计-${Date.now()}.xlsx`);
    await workbook.xlsx.writeFile(fallbackPath);
    return fallbackPath;
  }
}

async function main() {
  loadEnv();
  const owner = arg('--owner', 'a') === 'b' ? 'b' : 'a';
  const accountLabel = owner === 'b' ? '啵啵' : '麦满分';
  const telegramEnv = owner === 'b'
    ? { apiId: 'TG_BB_API_ID', apiHash: 'TG_BB_API_HASH', session: 'TG_BB_SESSION' }
    : { apiId: 'TG_API_ID', apiHash: 'TG_API_HASH', session: 'TG_SESSION' };
  for (const key of [telegramEnv.apiId, telegramEnv.apiHash, telegramEnv.session, 'DEEPSEEK_API_KEY', 'KV_REST_API_URL', 'KV_REST_API_TOKEN']) {
    if (!process.env[key]) throw new Error(`Missing ${key}`);
  }
  const days = Math.max(1, Number.parseInt(arg('--days', '7'), 10));
  const to = arg('--to') ? new Date(`${arg('--to')}T23:59:59+08:00`) : new Date();
  const from = arg('--from') ? new Date(`${arg('--from')}T00:00:00+08:00`) : new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
  const outputRoot = path.resolve(arg('--output', path.join(ROOT, 'artifacts', 'tg-feedback-audit', shanghaiDateKey(new Date()), owner)));
  const imageDir = path.join(outputRoot, 'screenshots');
  const cacheDir = path.join(outputRoot, 'cache');
  fs.mkdirSync(imageDir, { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });

  const client = new TelegramClient(
    new StringSession(process.env[telegramEnv.session]),
    Number.parseInt(process.env[telegramEnv.apiId], 10),
    process.env[telegramEnv.apiHash],
    { connectionRetries: 5, proxy: parseProxy(process.env.TG_PROXY), useWSS: false },
  );
  await client.connect();
  if (!await client.checkAuthorization()) throw new Error(`Telegram account ${owner.toUpperCase()} authorization is invalid`);
  const dialogs = await client.getDialogs({ limit: 500 });
  const dialog = dialogs.find((item) => {
    const username = clean(item.entity?.username).replace(/^@/, '').toLowerCase();
    const title = clean(item.title || item.name).replace(/^@/, '').toLowerCase();
    return (item.isUser || item.entity?.className === 'User') && (username === 'ojisamer' || title === 'ojisamer');
  });
  if (!dialog) throw new Error('Could not find private dialog @ojisamer');

  const messages = [];
  const limit = Math.max(200, Number.parseInt(arg('--limit', '4000'), 10));
  for await (const message of client.iterMessages(dialog.entity, { limit })) {
    const date = messageDate(message);
    if (date < from) break;
    if (date <= to) messages.push(message);
  }
  messages.sort((a, b) => Number(a.date) - Number(b.date));
  const imageEntries = messages.map((message, index) => ({ message, index })).filter(({ message }) => isImageMessage(message));
  const force = hasFlag('--force-ocr');

  const tasks = imageEntries.map(({ message, index }) => async () => {
    const extension = imageExtension(message);
    const baseName = `msg-${message.id}`;
    const imagePath = path.join(imageDir, `${baseName}${extension}`);
    const cachePath = path.join(cacheDir, `${baseName}.json`);
    if (!force && fs.existsSync(cachePath)) {
      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      if (cached.promptVersion === PROMPT_VERSION) return cached;
    }
    const buffer = Buffer.from(await client.downloadMedia(message, {}));
    fs.writeFileSync(imagePath, buffer);
    const result = await recognizeScreenshot(buffer, extension, contextFor(messages, index, accountLabel));
    const record = {
      promptVersion: PROMPT_VERSION,
      model: VISION_MODEL,
      messageId: String(message.id),
      feedbackAt: shanghaiDateTime(messageDate(message)),
      imagePath,
      ...result,
    };
    fs.writeFileSync(cachePath, JSON.stringify(record, null, 2));
    return record;
  });
  const recognized = await runPool(tasks, Math.max(1, Number.parseInt(arg('--concurrency', '2'), 10)));
  await client.disconnect();

  const [repushRaw, candidatesRaw] = await Promise.all([kvGet('recruit:repush'), kvGet('recruit:candidates')]);
  const allRecommendations = parseStored(repushRaw, []);
  const candidates = parseStored(candidatesRaw, []);
  const ownerRecommendations = dedupeRecommendations(allRecommendations.filter((item) => item.column === owner));
  const recommendations = ownerRecommendations.filter((item) => {
    const date = recommendationDate(item);
    return date && date >= from && date <= to;
  });

  const screenshotRows = [];
  const review = [];
  const feedbackByRecommendation = new Map();
  for (let index = 0; index < recognized.length; index += 1) {
    const record = recognized[index];
    const entry = imageEntries[index];
    if (record?.error) {
      const row = {
        messageId: String(entry.message.id), feedbackAt: shanghaiDateTime(messageDate(entry.message)),
        imagePath: '', error: record.error,
      };
      screenshotRows.push(row);
      review.push({ ...row, reason: '截图识别失败，需要人工查看' });
      continue;
    }
    if (!record.items.length) {
      screenshotRows.push({ ...record, result: '无候选人条目' });
      continue;
    }
    for (const item of record.items) {
      const normalizedItem = {
        ...item,
        jobTitle: screenshotJobTitle(record.rawText, item.candidateName) || item.jobTitle,
        result: normalizedFeedbackResult(item, record.rawText),
      };
      const row = { ...record, ...normalizedItem };
      delete row.items;
      screenshotRows.push(row);
      const match = matchFeedback(normalizedItem, ownerRecommendations, record.rawText);
      if (!match || match.ambiguous || match.score < 0.75 || normalizedItem.confidence < 0.6) {
        review.push({
          ...row,
          reason: match?.reason || '没有找到可信的推荐记录对应项',
        });
        continue;
      }
      const list = feedbackByRecommendation.get(match.recommendation.id) || [];
      list.push({ ...row, matchScore: match.score, matchReason: match.reason });
      feedbackByRecommendation.set(match.recommendation.id, list);
    }
  }

  const interviewFailed = [];
  const screeningFailed = [];
  const scheduledFeedback = [];
  const noFeedback = [];
  const explicitFailures = [];
  for (const rec of ownerRecommendations) {
    const feedback = feedbackByRecommendation.get(rec.id) || [];
    const explicitFailure = feedback
      .filter((item) => item.result === 'failed' && item.confidence >= 0.65)
      .sort((a, b) => String(b.feedbackAt).localeCompare(String(a.feedbackAt)))[0];
    if (explicitFailure) explicitFailures.push({ rec, explicitFailure });
  }
  for (const { rec, explicitFailure } of explicitFailures) {
    const candidate = findCandidateForRecommendation(rec, candidates);
    const stageText = `${explicitFailure.interviewStage} ${explicitFailure.feedbackSummary} ${explicitFailure.evidence}`;
    const isInterviewFailure = rec.interviewStatus === 'scheduled'
      || /(面试|一面|二面|三面|业务面|复试|终面|interview)/i.test(stageText);
    const row = reportRow(rec, {
      interviewStage: explicitFailure.interviewStage || clean(candidate?.stage),
      feedbackAt: explicitFailure.feedbackAt,
      feedbackSummary: explicitFailure.feedbackSummary,
      evidence: explicitFailure.evidence,
      confidence: explicitFailure.confidence,
      imagePath: explicitFailure.imagePath,
      telegramMessageId: String(explicitFailure.messageId || ''),
    });
    if (isInterviewFailure) interviewFailed.push(row);
    else screeningFailed.push(row);
  }
  for (const rec of recommendations) {
    const feedback = feedbackByRecommendation.get(rec.id) || [];
    const candidate = findCandidateForRecommendation(rec, candidates);
    const calendarFailure = candidate?.outcome === 'failed';
    if (calendarFailure && !interviewFailed.some((item) => item.candidateCode === normalizeCode(rec.candidateCode) && normalize(item.jobTitle) === normalize(rec.jdTitle))) {
      interviewFailed.push(reportRow(rec, {
        interviewStage: clean(candidate?.stage),
        feedbackAt: clean(candidate?.updatedAt || candidate?.interviewDate),
        feedbackSummary: '面试日历已标记未通过',
        evidence: '企鹅岛面试日历 outcome=failed',
        confidence: 1,
        imagePath: '',
      }));
      continue;
    }
    const terminalFeedback = feedback.some((item) => item.result === 'failed' || item.result === 'passed');
    const terminalCandidate = candidate?.stage === 'offer'
      || ['onboarded', 'withdrawn', 'offer-rejected', 'early-departure-7', 'early-departure-30'].includes(candidate?.outcome);
    const latestScheduled = feedback
      .filter((item) => item.result === 'scheduled')
      .sort((a, b) => String(b.feedbackAt).localeCompare(String(a.feedbackAt)))[0];
    if (!terminalFeedback && !terminalCandidate && latestScheduled) {
      scheduledFeedback.push(reportRow(rec, {
        feedbackAt: latestScheduled.feedbackAt,
        feedbackSummary: latestScheduled.feedbackSummary || latestScheduled.rawText || '已确认约面安排',
        evidence: latestScheduled.evidence,
        confidence: latestScheduled.confidence,
        imagePath: latestScheduled.imagePath,
        telegramMessageId: String(latestScheduled.messageId || ''),
        interviewStatus: '已约面',
        auditConclusion: '反馈截图已确认约面安排',
      }));
      continue;
    }
    if (!terminalFeedback && !terminalCandidate) {
      const latest = [...feedback].sort((a, b) => String(b.feedbackAt).localeCompare(String(a.feedbackAt)))[0];
      const hasPending = feedback.some((item) => item.result === 'pending' || item.result === 'no_feedback');
      noFeedback.push(reportRow(rec, {
        feedbackAt: latest?.feedbackAt || '',
        latestStatus: hasPending ? '待反馈' : latest ? '未识别到结论' : '无对应截图',
        feedbackSummary: latest?.feedbackSummary || latest?.rawText || '',
        auditConclusion: hasPending
          ? '截图明确显示待反馈/暂无反馈'
          : candidate?.stage
            ? `有面试记录（${clean(candidate.stage)}），但近 ${days} 天截图中未找到明确反馈`
            : `近 ${days} 天反馈截图中未找到明确结论`,
        imagePath: latest?.imagePath || '',
        telegramMessageId: String(latest?.messageId || ''),
        evidence: latest?.evidence || '',
      }));
    }
  }

  noFeedback.sort((a, b) => String(b.recommendedAt).localeCompare(String(a.recommendedAt)));
  interviewFailed.sort((a, b) => String(b.feedbackAt).localeCompare(String(a.feedbackAt)));
  screeningFailed.sort((a, b) => String(b.feedbackAt).localeCompare(String(a.feedbackAt)));
  const meta = {
    generatedAt: new Date().toISOString(),
    owner,
    accountLabel,
    days,
    from: shanghaiDateTime(from),
    to: shanghaiDateTime(to),
    messageCount: messages.length,
    screenshotCount: imageEntries.length,
    recommendationCount: recommendations.length,
    noFeedbackCount: noFeedback.length,
    scheduledCount: scheduledFeedback.length,
    failedCount: interviewFailed.length,
    screeningFailedCount: screeningFailed.length,
    reviewCount: review.length,
  };
  const feedbackInboxCount = hasFlag('--sync')
    ? await syncFeedbackInbox(owner, meta, noFeedback, scheduledFeedback, interviewFailed, screeningFailed, review)
    : 0;
  const workbookPath = await writeReport(outputRoot, meta, noFeedback, interviewFailed, screeningFailed, review, screenshotRows);
  fs.writeFileSync(path.join(outputRoot, '复推反馈审计.json'), JSON.stringify({ meta, noFeedback, scheduledFeedback, interviewFailed, screeningFailed, review, screenshots: screenshotRows }, null, 2));
  console.log(JSON.stringify({ ok: true, ...meta, feedbackInboxCount, workbookPath }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: clean(error?.message || error) }));
  process.exitCode = 1;
});
