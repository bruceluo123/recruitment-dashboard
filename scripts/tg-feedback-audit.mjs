#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';

const ROOT = process.cwd();
const ENV_PATH = path.join(ROOT, '.env.local');
const PROMPT_VERSION = 'feedback-audit-v8';
const VISION_MODEL = 'deepseek-v4-flash-vision-exp';
const STANDARD_FORMAT_GUIDANCE = '标准反馈格式为“部门或组织＋候选人姓名＋截图”。例如截图紧邻“效能中心 Andy”时，先锁定 organization=效能中心、candidateName=Andy，再从截图或引用推荐语中提取岗位和反馈结论并精确对应；“恒睿 eli”同理。';

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

function candidateNamesMatch(left, right) {
  const a = normalizeName(left);
  const b = normalizeName(right);
  if (!a || !b) return false;
  return a === b || (Math.min(a.length, b.length) >= 3 && (a.includes(b) || b.includes(a)));
}

function editDistance(left, right) {
  const a = normalizeName(left);
  const b = normalizeName(right);
  if (!a) return b.length;
  if (!b) return a.length;
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= a.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= b.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (a[leftIndex - 1] === b[rightIndex - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[b.length];
}

function candidateLabelScore(text, candidateName) {
  if (candidateNameMentioned(text, candidateName)) return 1;
  const expected = normalizeName(candidateName);
  if (!/^[a-z0-9]+$/.test(expected) || expected.length < 5) return 0;
  const tokens = String(text || '').toLowerCase().match(/[a-z][a-z0-9.'_-]{3,}/g) || [];
  return tokens.reduce((best, token) => {
    const actual = normalizeName(token);
    if (actual.length < 5 || Math.abs(actual.length - expected.length) > 2) return best;
    const score = 1 - editDistance(actual, expected) / Math.max(actual.length, expected.length);
    return Math.max(best, score);
  }, 0);
}

function normalizeCode(value) {
  const match = String(value || '').match(/XY\s*(MMF|BB)\s*([0-9O]{1,6})/i);
  if (!match) return '';
  const digits = match[2].replace(/O/gi, '0');
  return `XY${match[1].toUpperCase()}${digits.padStart(5, '0')}`;
}

function uniqueCandidateCode(value) {
  const codes = [...String(value || '').matchAll(/XY\s*(?:MMF|BB)\s*[0-9O]{1,6}/gi)]
    .map((match) => normalizeCode(match[0]))
    .filter(Boolean);
  const unique = [...new Set(codes)];
  return unique.length === 1 ? unique[0] : '';
}

function codeBelongsToOwner(code, owner) {
  const normalized = normalizeCode(code);
  if (!normalized) return true;
  return owner === 'b' ? normalized.startsWith('XYBB') : normalized.startsWith('XYMMF');
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
  ['极乐引擎', '极乐', '极乐引擎-CN'],
  ['瑞升公司', '瑞升', '瑞声'],
  ['紫宸星宇', '紫宸'],
  ['万有引力', '万有'],
  ['悦达'],
  ['无极'],
  ['鼎丰'],
  ['经纬'],
  ['happy'],
  ['odc', '组织发展中心'],
  ['效能中心', '效能'],
  ['技术中心', '技术部'],
  ['渠道中心', '渠道'],
  ['星河无界', '星河'],
  ['孵化中心', '孵化'],
  ['恒睿'],
  ['迷境'],
  ['领航'],
  ['逸品'],
  ['天权'],
  ['天枢'],
];

const NON_CANDIDATE_NAMES = new Set([
  'bruce', 'ojisamer', '麦满分', '啵啵', 'bobo', 'robin', 'robinlee99',
  '极乐', '极乐引擎', '瑞升', '瑞升公司', '紫宸', '紫宸星宇', '万有引力',
  '悦达', '无极', '鼎丰', '经纬', 'happy', 'odc', '技术中心', '运营中心',
  '效能中心', '渠道中心', '候选人', '面试官', 'hr', 'bp',
].map(normalizeName));

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

function screenshotFilePartsList(rawText) {
  const raw = String(rawText || '');
  const files = [...raw.matchAll(/([^,，。；;：:\n]{2,140}?)\.(?:pdf|docx?)/gi)];
  const results = [];
  for (const match of files) {
    const stem = clean(match[1]).replace(/^.*(?:文件|简历|topic)\s*[：:]\s*/i, '');
    const parts = stem.split(/[-_—–]/).map(clean).filter(Boolean);
    if (parts.length < 2) continue;
    const candidateName = parts[0].replace(/^[^a-z0-9\u4e00-\u9fa5]+/i, '');
    const jobTitle = clean(parts.slice(1).join(' ')).replace(/\s*\(\d+\)\s*$/i, '');
    if (candidateName && jobTitle) results.push({ candidateName, jobTitle });
  }
  return results;
}

function screenshotFileParts(rawText) {
  return screenshotFilePartsList(rawText)[0] || { candidateName: '', jobTitle: '' };
}

function sanitizeCandidateName(value) {
  return clean(value)
    .replace(/\s*(?:性别|年龄|工作年限|应聘岗位|当前薪资|期望薪资)\s*[：:].*$/i, '')
    .replace(/\s*[1-9][\ufe0f\u20e3].*$/, '')
    .trim();
}

function sanitizeJobTitle(value) {
  const title = clean(value);
  if (!title || title.length > 100) return '';
  if (/(?:Ojisamer|Bruce|Robin|Reply|候选人编码|简历推荐人|寻英\s*[➡➜→]|招聘\s*(?:MY|CN))/i.test(title)) return '';
  return title;
}

function isLikelyCandidateName(value) {
  const name = normalizeName(sanitizeCandidateName(value));
  return Boolean(name && name.length >= 2 && !NON_CANDIDATE_NAMES.has(name));
}

function explicitCandidateName(rawText) {
  const match = String(rawText || '').match(/候选人(?:姓名)?(?:\s*[（(]英文名[）)])?\s*[：:]\s*([^\n,，。；;]{1,40}?)(?=\s*(?:[-—–|]|应聘岗位|岗位|部门|编制|$))/i);
  return isLikelyCandidateName(match?.[1]) ? clean(match[1]) : '';
}

function explicitJobTitle(rawText) {
  const match = String(rawText || '').match(/(?:应聘岗位|岗位)\s*[：:]\s*([^\n,，；;]{2,100}?)(?=\s*(?:部门|编制|服务单位|工作年限|当前薪资|期望薪资|$))/i);
  return sanitizeJobTitle(match?.[1]);
}

function structuredIdentity(rawText) {
  const raw = String(rawText || '');
  const topic = raw.match(/(?:topic|会议主题)\s*[：:]\s*([^\n]{2,120})/i)?.[1] || '';
  const topicParts = topic.split(/[-_—–|]/).map(clean).filter(Boolean);
  const candidateName = explicitCandidateName(raw)
    || (topicParts.length >= 2 && isLikelyCandidateName(topicParts[0]) ? topicParts[0] : '');
  const jobTitle = explicitJobTitle(raw)
    || (topicParts.length >= 2 ? clean(topicParts.slice(1).join(' ')) : '');
  return {
    candidateCode: normalizeCode(raw),
    candidateName,
    jobTitle,
    organization: detectedOrganization(raw),
  };
}

function detectedOrganization(rawText) {
  const raw = clean(rawText);
  for (const aliases of ORGANIZATION_ALIAS_GROUPS) {
    const matched = aliases.find((alias) => normalize(raw).includes(normalize(alias)));
    if (matched) return aliases[0];
  }
  const labeled = raw.match(/(?:部门|服务单位|编制组织|组织|单位)\s*[：:]\s*([^,，。；;\n]{2,30})/i)?.[1];
  return clean(labeled);
}

function screenshotJobTitle(rawText, candidateName) {
  const raw = String(rawText || '');
  const escapedName = clean(candidateName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (escapedName) {
    const namedFile = raw.match(new RegExp(`${escapedName}\\s*[-_—–]\\s*([^,，。\\n]{1,100}?)\\.(?:pdf|docx?)`, 'i'));
    if (namedFile?.[1]) return clean(namedFile[1]);
  }
  return screenshotFileParts(raw).jobTitle;
}

function normalizedFeedbackResult(item, rawText, itemCount = 1) {
  const itemText = clean(`${item.interviewStage} ${item.feedbackSummary} ${item.evidence}`);
  const text = clean(`${itemText} ${itemCount === 1 ? rawText : ''}`);
  if (/(未通过|没通过|不通过|不过了|没过|不合适|不匹配|不符合|不考虑|不推荐|不要了?|不推进|淘汰|拒绝|拒了|面试失败|面试挂|挂了|不约面|暂不约|放弃面试|放弃推进|取消面试|终止流程)/i.test(text)) return 'failed';
  if (/(辛苦约|约面|已约|安排.{0,8}面试|面试.{0,8}(安排|时间)|会议邀请|zoom|约.{0,12}(今天|明天|上午|下午|晚上|\d{1,2}\s*[:：]\s*\d{2}))/i.test(text)) return 'scheduled';
  if (/(面试通过|初筛通过|简历通过|通过初筛|过了初筛|过了面试|进入下一轮|进入[二三]面|安排下一轮|可以推进|继续推进|发\s*offer|已录用|确认录用)/i.test(text)) return 'passed';
  if (/(待反馈|还没反馈|暂无反馈|等反馈|催一下|跟进一下|待定|先等等|横向对比)/i.test(text)) return 'pending';
  if (/(薪资|期望|到岗|工作地点|开视频|改期|迟到|缺席|失联|联系不上|意向|背调|试岗|入职时间)/i.test(text)) return 'other';
  return item.result;
}

function itemSpecificContext(context, item) {
  const lines = String(context || '').split(/\r?\n/).filter(Boolean);
  const code = normalizeCode(item?.candidateCode);
  const name = clean(item?.candidateName);
  const matched = new Set();
  lines.forEach((line, index) => {
    const hasName = name && candidateNameMentioned(line, name);
    const hasCode = !name && code && normalizeCode(line) === code;
    if (!hasCode && !hasName) return;
    matched.add(index);
    if (index > 0) matched.add(index - 1);
    if (index + 1 < lines.length) matched.add(index + 1);
  });
  return [...matched].sort((a, b) => a - b).map((index) => lines[index]).join('\n');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function kvGet(key) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(`${process.env.KV_REST_API_URL}/get/${encodeURIComponent(key)}`, {
        headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return (await response.json()).result;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await sleep(attempt * 1_000);
    }
  }
  throw new Error(`KV get ${key} failed: ${clean(lastError?.message || lastError)}`);
}

async function kvSet(key, value) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(`${process.env.KV_REST_API_URL}/set/${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`,
          'Content-Type': 'text/plain; charset=utf-8',
        },
        body: typeof value === 'string' ? value : JSON.stringify(value),
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return true;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await sleep(attempt * 1_000);
    }
  }
  throw new Error(`KV set ${key} failed: ${clean(lastError?.message || lastError)}`);
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

function replyToMessageId(message) {
  return String(message?.replyTo?.replyToMsgId || message?.replyTo?.replyToTopId || message?.replyToMsgId || '');
}

function formatContextMessage(message, accountLabel, label) {
  return `[${label} 消息${message.id}] ${message.out ? accountLabel : 'ojisamer'} ${shanghaiDateTime(messageDate(message))}: ${clean(message.message)}`;
}

function recommendationReference(text, recommendations) {
  const source = clean(text);
  if (!source) return null;
  const sourceCode = normalizeCode(source);
  const ranked = recommendations
    .map((rec) => {
      const codeMatch = sourceCode && normalizeCode(rec.candidateCode) === sourceCode;
      const nameMatch = candidateNameMentioned(source, rec.candidateName);
      if (!codeMatch && !nameMatch) return null;
      const job = jobSimilarity(source, rec.jdTitle);
      const organization = organizationSimilarity(source, `${rec.organization} ${rec.department}`);
      return {
        rec,
        score: (codeMatch ? 100 : 40) + job * 20 + organization * 16,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score
      || (recommendationDate(b.rec)?.getTime() || 0) - (recommendationDate(a.rec)?.getTime() || 0));
  if (!ranked.length) return null;
  if (ranked.length === 1 || ranked[0].score - ranked[1].score >= 4) return ranked[0].rec;
  return null;
}

function standardIdentityLabel(text, recommendations) {
  const source = clean(text);
  const organization = detectedOrganization(source);
  if (!source || !organization) return null;
  const ranked = [...new Map(recommendations
    .filter((rec) => organizationSimilarity(organization, `${rec.organization} ${rec.department}`) > 0)
    .map((rec) => {
      const score = candidateLabelScore(source, rec.candidateName);
      return [normalizeName(rec.candidateName), {
        candidateCode: normalizeCode(rec.candidateCode),
        candidateName: clean(rec.candidateName),
        score,
      }];
    }))
    .values()]
    .filter((candidate) => candidate.score >= 0.82)
    .sort((a, b) => b.score - a.score || a.candidateName.localeCompare(b.candidateName));
  if (!ranked.length || (ranked[1] && ranked[0].score - ranked[1].score < 0.08)) return null;
  return { candidateCode: ranked[0].candidateCode, candidateName: ranked[0].candidateName, organization };
}

function referenceContextFor(messages, index, accountLabel, recommendations) {
  const current = messages[index];
  const byId = new Map(messages.map((message) => [String(message.id), message]));
  const direct = [];
  let replyId = replyToMessageId(current);
  const visited = new Set();
  while (replyId && !visited.has(replyId) && direct.length < 4) {
    visited.add(replyId);
    const replied = byId.get(replyId);
    if (!replied) break;
    if (clean(replied.message)) direct.push(replied);
    replyId = replyToMessageId(replied);
  }
  if (direct.length) {
    return direct.map((message, replyIndex) => formatContextMessage(
      message,
      accountLabel,
      replyIndex === 0 ? '直接回复的上文' : '继续引用的上文',
    )).join('\n');
  }

  const currentText = clean(current.message);
  if (currentText && (
    recommendationReference(currentText, recommendations)
    || standardIdentityLabel(currentText, recommendations)
  )) {
    return formatContextMessage(current, accountLabel, '当前身份标签');
  }

  const currentTime = messageDate(current).getTime();
  for (let nextIndex = index + 1; nextIndex < Math.min(messages.length, index + 4); nextIndex += 1) {
    const next = messages[nextIndex];
    if (messageDate(next).getTime() - currentTime > 5 * 60 * 1000) break;
    if (next.out !== current.out) continue;
    const nextText = clean(next.message);
    if (nextText && (
      recommendationReference(nextText, recommendations)
      || standardIdentityLabel(nextText, recommendations)
    )) {
      return formatContextMessage(next, accountLabel, '紧随其后的身份标签');
    }
  }

  for (let previousIndex = index - 1; previousIndex >= Math.max(0, index - 16); previousIndex -= 1) {
    const previous = messages[previousIndex];
    if (currentTime - messageDate(previous).getTime() > 20 * 60 * 1000) break;
    const previousText = clean(previous.message);
    if (!previous.out || !previousText) continue;
    if (recommendationReference(previousText, recommendations)) {
      return formatContextMessage(previous, accountLabel, '向上找到的推荐语');
    }
  }
  return '';
}

function contextFor(messages, index, accountLabel, referenceContext = '') {
  const current = messages[index];
  const lines = [];
  void referenceContext;
  if (clean(current.message)) lines.push(formatContextMessage(current, accountLabel, '当前'));
  return lines.join('\n');
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
  const normalizedItems = items.map((item) => {
    const result = allowed.has(item?.result) ? item.result : 'unknown';
    const candidateName = sanitizeCandidateName(item?.candidateName);
    return {
      candidateCode: normalizeCode(item?.candidateCode),
      candidateCodeConflict: Boolean(item?.candidateCodeConflict),
      candidateName: isLikelyCandidateName(candidateName) ? candidateName : '',
      jobTitle: sanitizeJobTitle(item?.jobTitle),
      organization: clean(item?.organization),
      interviewStage: clean(item?.interviewStage),
      result,
      feedbackSummary: clean(item?.feedbackSummary),
      evidence: clean(item?.evidence),
      confidence: Math.max(0, Math.min(1, Number(item?.confidence) || 0)),
    };
  });
  const namesByCode = new Map();
  for (const item of normalizedItems) {
    if (!item.candidateCode || !item.candidateName) continue;
    const names = namesByCode.get(item.candidateCode) || new Set();
    names.add(normalizeName(item.candidateName));
    namesByCode.set(item.candidateCode, names);
  }
  for (const item of normalizedItems) {
    if ((namesByCode.get(item.candidateCode)?.size || 0) > 1) {
      item.candidateCode = '';
      item.candidateCodeConflict = true;
    }
  }
  return {
    screenType: clean(value?.screenType || 'other'),
    rawText: clean(value?.rawText),
    items: normalizedItems,
  };
}

async function recognizeScreenshot(buffer, extension, context, referenceContext) {
  const mime = extension === '.png' ? 'image/png' : extension === '.webp' ? 'image/webp' : 'image/jpeg';
  const prompt = `你是招聘反馈截图审计助手。逐块识别截图中的候选人、岗位、部门或服务单位、面试轮次和明确反馈。\n\n规则：\n1. 一张截图里出现多位候选人、多个附件或多条反馈时，必须按候选人逐条输出 items，不能合并。\n2. 候选人身份按可靠性依次取：候选人编码；截图“候选人姓名”字段；附件文件名“姓名-岗位.pdf/doc/docx”；会议 Topic；明确被回复或引用的推荐语。\n3. “被回复/引用的上文”是当前截图的身份锚点，可以从中补候选人、岗位和组织；不得从其他相邻消息借用候选人编码或姓名。截图自身出现的身份永远优先于引用上文。\n4. 像“恒睿 eli”这样的“组织＋姓名”标签表示恒睿的候选人 eli；引用完整推荐语时，要沿用其中的候选人编码、姓名、岗位和组织。\n5. Bruce、ojisamer、麦满分、啵啵、BOBO、Robin、HR、BP，以及极乐、瑞升、紫宸、万有引力、悦达、无极、鼎丰、经纬、Happy、ODC 等招聘人或组织名绝不是候选人姓名。\n6. 明确出现“未通过、不通过、不合适、淘汰、拒绝、不推进、不约面、放弃面试”等否定结论时 result=failed。先识别否定句，绝不能因其中含有“通过”二字而判 passed。\n7. 明确出现“面试通过、初筛通过、进入下一轮、录用”等肯定结论时 result=passed；约面、面试时间、会议邀请为 scheduled；“待反馈、还没反馈、催一下、先等等”为 pending。\n8. 其他薪资、到岗、意向、改期、缺席等沟通也输出，result 用 pending 或 other。\n9. 优先保留附件文件名中的岗位和截图中的组织简称，不要用相似岗位替换，也不要自行扩写简称。\n10. rawText 只能转写图片里实际看见的文字，绝对不能复制“被回复/引用的上文”或“当前消息”文字。看不清的字段留空，不得猜测。evidence 只写支持结论的短句，confidence 为 0 到 1。只返回 JSON，不要 Markdown。\n\nJSON 格式：\n{"screenType":"feedback|schedule|recommendation|chat|other","rawText":"只保留图片本身的文字、附件名和候选人编码","items":[{"candidateCode":"","candidateName":"","jobTitle":"","organization":"","interviewStage":"","result":"passed|failed|scheduled|pending|no_feedback|other|unknown","feedbackSummary":"","evidence":"","confidence":0.0}]}\n\n被回复/引用的上文（身份优先）：\n${referenceContext || '无'}\n\n当前消息：\n${context || '无'}`;
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(90_000),
        body: JSON.stringify({
          model: VISION_MODEL,
          temperature: 0,
          thinking: { type: 'disabled' },
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: `${prompt}\n\n${STANDARD_FORMAT_GUIDANCE}` },
              { type: 'image_url', image_url: { url: `data:${mime};base64,${buffer.toString('base64')}` } },
            ],
          }],
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(`DeepSeek vision failed: ${response.status} ${clean(body?.error?.message)}`);
      const result = sanitizeVisionResult(extractJson(body?.choices?.[0]?.message?.content));
      if (!result.rawText && !result.items.length) throw new Error('DeepSeek vision returned an empty result');
      return result;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await sleep(1_000 * attempt);
    }
  }
  throw lastError;
}

function isPotentialRecruitingText(text, referenceContext, recommendations) {
  const current = clean(text);
  if (!current) return false;
  if (/^(收到|好的|好|嗯|嗯嗯|ok|okay|辛苦了|谢谢|等等)[。！!，,\s]*$/i.test(current)) return false;
  const recruitingSignal = /(候选人|简历|面试|初筛|复试|终面|约面|通过|没过|未过|不合适|不匹配|不考虑|淘汰|拒绝|推进|待反馈|反馈|薪资|期望|到岗|入职|改期|缺席|失联|offer)/i;
  if (recruitingSignal.test(current) || normalizeCode(current)) return true;
  if (recommendations.some((rec) => candidateNameMentioned(current, rec.candidateName))) return true;
  const shortReply = current.length <= 24 && /(可以|不行|要|不要|行|待定|约|过|不过|继续|暂停|放弃)/i.test(current);
  if (!shortReply) return false;
  const referenced = clean(referenceContext);
  return Boolean(referenced && recommendationReference(referenced, recommendations));
}

async function recognizeTextMessage(text, context, referenceContext) {
  const prompt = `你是招聘聊天反馈审计助手。只判断“当前消息”本身是否包含对候选人或岗位流程有意义的信息。\n\n规则：\n1. 当前消息与招聘反馈无关时，items 返回空数组。\n2. 当前消息涉及多位候选人或多个岗位时，逐条输出 items。\n3. 身份优先级：候选人编码、当前消息明确姓名、附件名、被回复/引用推荐语中的唯一候选人。“恒睿 eli”表示恒睿的候选人 eli。\n4. 被回复/引用的上文只用于补齐当前消息的候选人、岗位和组织，不得把上文结论当成当前消息结论，也不得借用其他相邻消息的身份。\n5. 未通过、不合适、不推进、淘汰、拒绝等 result=failed；约面或给出面试时间 result=scheduled；明确通过或进入下一轮 result=passed；等待或催反馈 result=pending；薪资、到岗、意向、改期等 result=other。\n6. evidence 只摘录当前消息中支持判断的短句，confidence 为 0 到 1。只返回 JSON。\n\nJSON 格式：\n{"screenType":"feedback|schedule|chat|other","rawText":"当前消息原文","items":[{"candidateCode":"","candidateName":"","jobTitle":"","organization":"","interviewStage":"","result":"passed|failed|scheduled|pending|no_feedback|other|unknown","feedbackSummary":"","evidence":"","confidence":0.0}]}\n\n当前消息：\n${clean(text)}\n\n被回复/引用的上文（身份优先）：\n${referenceContext || '无'}\n\n当前消息结构化上下文：\n${context || '无'}`;
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(90_000),
        body: JSON.stringify({
          model: VISION_MODEL,
          temperature: 0,
          thinking: { type: 'disabled' },
          messages: [{ role: 'user', content: `${prompt}\n\n${STANDARD_FORMAT_GUIDANCE}` }],
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(`DeepSeek text audit failed: ${response.status} ${clean(body?.error?.message)}`);
      return sanitizeVisionResult(extractJson(body?.choices?.[0]?.message?.content));
    } catch (error) {
      lastError = error;
      if (attempt < 3) await sleep(1_000 * attempt);
    }
  }
  throw lastError;
}

function enrichVisionItem(item, record) {
  const singleItem = record.items.length === 1;
  const directText = clean(`${singleItem ? record.rawText : ''} ${item.feedbackSummary} ${item.evidence}`);
  const fileParts = screenshotFileParts(directText);
  const explicitName = explicitCandidateName(directText);
  const detectedCode = item.candidateCodeConflict
    ? ''
    : normalizeCode(item.candidateCode) || uniqueCandidateCode(directText);
  let candidateName = sanitizeCandidateName(item.candidateName);
  if (!isLikelyCandidateName(candidateName)) candidateName = explicitName || fileParts.candidateName;
  const relatedContext = itemSpecificContext(record.context, { ...item, candidateName, candidateCode: detectedCode });
  return {
    ...item,
    candidateCode: detectedCode,
    candidateName: isLikelyCandidateName(candidateName) ? candidateName : '',
    jobTitle: sanitizeJobTitle(screenshotJobTitle(directText, candidateName))
      || sanitizeJobTitle(fileParts.jobTitle)
      || sanitizeJobTitle(item.jobTitle)
      || sanitizeJobTitle(screenshotJobTitle(clean(`${directText} ${relatedContext}`), candidateName)),
    organization: item.organization || detectedOrganization(directText),
    result: normalizedFeedbackResult(
      item,
      clean(`${record.items.length === 1 ? record.rawText : ''} ${relatedContext}`),
      1,
    ),
  };
}

function candidateNameMentioned(text, candidateName) {
  const name = clean(candidateName);
  if (!isLikelyCandidateName(name)) return false;
  if (/^[a-z][a-z\s.'-]+$/i.test(name)) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`, 'i').test(text);
  }
  return String(text || '').includes(name);
}

function inferIdentityFromContext(item, record, recommendations) {
  const currentCode = normalizeCode(item.candidateCode);
  const currentName = normalizeName(item.candidateName);
  const identityExists = recommendations.some((rec) => (
    (currentCode && normalizeCode(rec.candidateCode) === currentCode)
    || (currentName && normalizeName(rec.candidateName) === currentName)
  ));
  const relatedContext = itemSpecificContext(record.context, item);
  const hasItemIdentity = Boolean(currentCode || currentName);
  const itemText = clean(`${item.feedbackSummary} ${item.evidence}`);
  const directText = record.items?.length === 1 ? record.rawText : itemText;
  const referenceText = clean(record.referenceContext);
  const referencedRecommendation = recommendationReference(referenceText, recommendations);
  const referenceIdentity = standardIdentityLabel(referenceText, recommendations);
  const standardIdentity = referenceIdentity || standardIdentityLabel(relatedContext, recommendations);
  if (referenceIdentity && record.items?.length === 1) {
    return {
      ...item,
      candidateCode: referenceIdentity.candidateCode,
      candidateName: referenceIdentity.candidateName,
      organization: referenceIdentity.organization || item.organization,
    };
  }
  if (referencedRecommendation) {
    const referencedCode = normalizeCode(referencedRecommendation.candidateCode);
    const referencedName = normalizeName(referencedRecommendation.candidateName);
    const sameIdentity = !hasItemIdentity
      || (currentCode && referencedCode === currentCode)
      || (currentName && candidateNamesMatch(currentName, referencedName));
    if (sameIdentity) {
      return {
        ...item,
        candidateCode: currentCode || referencedCode,
        candidateName: item.candidateName || clean(referencedRecommendation.candidateName),
        jobTitle: item.jobTitle || clean(referencedRecommendation.jdTitle),
        organization: item.organization || clean(referencedRecommendation.organization || referencedRecommendation.department),
        referencedRecommendationId: clean(referencedRecommendation.id),
      };
    }
  }
  const text = clean(`${directText} ${relatedContext} ${!hasItemIdentity ? referenceText : ''}`);
  const structured = structuredIdentity(text);
  if (item.candidateCodeConflict) structured.candidateCode = '';
  if (identityExists) {
    return {
      ...item,
      jobTitle: item.jobTitle || structured.jobTitle,
      organization: item.organization || standardIdentity?.organization || structured.organization,
    };
  }
  if (!hasItemIdentity && standardIdentity) {
    return {
      ...item,
      candidateName: standardIdentity.candidateName,
      jobTitle: item.jobTitle || structured.jobTitle,
      organization: item.organization || standardIdentity.organization,
    };
  }
  if (structured.candidateCode || structured.candidateName) {
    const structuredExists = recommendations.some((rec) => (
      (structured.candidateCode && normalizeCode(rec.candidateCode) === structured.candidateCode)
      || (structured.candidateName && normalizeName(rec.candidateName) === normalizeName(structured.candidateName))
    ));
    if (structuredExists) return { ...item, ...structured };
  }
  const codeMatches = item.candidateCodeConflict ? [] : [...text.matchAll(/XY\s*(?:MMF|BB)\s*[0-9O]{1,6}/gi)]
    .map((match) => normalizeCode(match[0]))
    .filter(Boolean);
  const uniqueCodes = [...new Set(codeMatches)];
  if (uniqueCodes.length === 1) {
    const rec = recommendations.find((candidate) => normalizeCode(candidate.candidateCode) === uniqueCodes[0]);
    if (rec) return { ...item, candidateCode: uniqueCodes[0], candidateName: clean(rec.candidateName) };
  }
  const fileNames = screenshotFilePartsList(text)
    .map((part) => ({ ...part, normalizedName: normalizeName(part.candidateName) }))
    .filter((part) => isLikelyCandidateName(part.candidateName));
  const uniqueFileNames = [...new Map(fileNames.map((part) => [part.normalizedName, part])).values()];
  if (uniqueFileNames.length === 1) {
    const matchingNames = recommendations.filter((rec) => (
      normalizeName(rec.candidateName) === uniqueFileNames[0].normalizedName
    ));
    if (!matchingNames.length) return item;
    return {
      ...item,
      candidateName: uniqueFileNames[0].candidateName,
      jobTitle: item.jobTitle || uniqueFileNames[0].jobTitle,
    };
  }
  const mentionedNames = [...new Map(recommendations
    .filter((rec) => candidateNameMentioned(text, rec.candidateName))
    .map((rec) => [normalizeName(rec.candidateName), clean(rec.candidateName)]))
    .values()];
  if (mentionedNames.length === 1) return { ...item, candidateName: mentionedNames[0] };
  return item;
}

function inferItemFromRecord(record, recommendations) {
  const text = clean(`${record.rawText || ''} ${record.context || ''}`);
  if (!text) return null;
  const structured = structuredIdentity(text);
  const seed = {
    candidateCode: structured.candidateCode,
    candidateName: structured.candidateName,
    jobTitle: structured.jobTitle,
    organization: structured.organization,
    interviewStage: '',
    result: normalizedFeedbackResult({ result: 'unknown' }, text, 1),
    feedbackSummary: clean(record.rawText),
    evidence: clean(record.rawText).slice(0, 240),
    confidence: 0.62,
  };
  const inferred = inferIdentityFromContext(seed, record, recommendations);
  const hasIdentity = normalizeCode(inferred.candidateCode) || isLikelyCandidateName(inferred.candidateName);
  if (!hasIdentity || inferred.result === 'unknown') return null;
  return inferred;
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
  return toDate(item.recommendedAt || item.uploadedAt || item.createdAt || item.updatedAt);
}

function dedupeRecommendations(items) {
  const map = new Map();
  for (const item of items) {
    const key = [
      normalizeCode(item.candidateCode) || normalizeName(item.candidateName),
      normalize(item.jdTitle),
      normalize(item.organization),
      normalize(item.department),
    ].join('|');
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
  const uniqueExactMatch = (matches) => {
    if (!matches.length) return null;
    const title = normalize(effectiveJobTitle);
    if (title) {
      const exact = matches.filter((rec) => normalize(rec.jdTitle) === title);
      if (exact.length === 1) return exact[0];
      const contained = matches.filter((rec) => {
        const recTitle = normalize(rec.jdTitle);
        return recTitle.length >= 4 && title.length >= 4 && (recTitle.includes(title) || title.includes(recTitle));
      });
      if (contained.length === 1) return contained[0];
    }
    if (item.organization) {
      const sameOrganization = matches.filter((rec) => (
        organizationSimilarity(item.organization, `${rec.organization} ${rec.department}`) === 1
      ));
      if (sameOrganization.length === 1) return sameOrganization[0];
    }
    return null;
  };
  const code = normalizeCode(item.candidateCode);
  if (code) {
    const codeMatches = recommendations.filter((rec) => normalizeCode(rec.candidateCode) === code);
    if (codeMatches.length === 1) return { recommendation: codeMatches[0], score: 1, reason: '候选人编码一致' };
    if (codeMatches.length > 1) {
      const exact = uniqueExactMatch(codeMatches);
      if (exact) return { recommendation: exact, score: 0.99, reason: '候选人编码一致，岗位或部门唯一对应' };
      const ranked = rankMatches(codeMatches);
      const hasLocator = Boolean(effectiveJobTitle || item.organization);
      const uniquelyRanked = ranked.length === 1 || ranked[0].rank > ranked[1].rank;
      if (hasLocator && uniquelyRanked && (ranked[0].job > 0 || ranked[0].organization > 0)) {
        return { recommendation: ranked[0].rec, score: 0.98, reason: fileJobTitle ? '候选人编码一致，按截图文件名及单位匹配' : '候选人编码一致，按岗位及单位匹配' };
      }
      return { ambiguous: codeMatches, score: 0.6, reason: '候选人编码一致，但同一人有多个岗位且截图缺少可区分信息' };
    }
    return null;
  }
  const name = normalizeName(item.candidateName);
  if (!name) return null;
  const sameName = recommendations.filter((rec) => normalizeName(rec.candidateName) === name);
  const exact = uniqueExactMatch(sameName);
  if (exact) return { recommendation: exact, score: 0.98, reason: '候选人姓名一致，岗位或部门唯一对应' };
  const candidates = rankMatches(sameName);
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
    return [
      owner,
      sourceStatus,
      'tg',
      clean(row.telegramMessageId || row.messageId),
      normalizeCode(row.candidateCode) || normalizeName(row.candidateName) || index,
      normalize(row.jobTitle) || index,
    ].join(':');
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
  const possibleRecommendations = clean(row.possibleRecommendations);
  const categoryLabel = clean(row.categoryLabel);
  const auditConclusion = clean(row.auditConclusion || row.reason);
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
    auditConclusion: [categoryLabel, auditConclusion, possibleRecommendations ? `可能岗位：${possibleRecommendations}` : '']
      .filter(Boolean)
      .join('；') || undefined,
    confidence: Number.isFinite(Number(row.confidence)) ? Number(row.confidence) : undefined,
    telegramMessageId: clean(row.telegramMessageId || row.messageId) || undefined,
    followUpCount: 0,
    timeline: [],
    updatedAt: generatedAt,
  };
}

async function syncFeedbackInbox(owner, meta, noFeedback, scheduledFeedback, interviewFailed, screeningFailed, ledger) {
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
    if (previous.sourceStatus === 'manual_review') continue;
    const hasUserWork = previous.confirmedStatus
      || Number(previous.followUpCount) > 0
      || previous.repushReady
      || (Array.isArray(previous.timeline) && previous.timeline.length > 0);
    if (!importedIds.has(clean(previous.id)) && hasUserWork) items.push(previous);
  }
  const existingLedger = Array.isArray(existing?.ledger) ? existing.ledger : [];
  const combinedLedger = [
    ...ledger,
    ...existingLedger.filter((item) => (item.owner === 'b' ? 'b' : 'a') !== owner),
  ];
  await kvSet(key, { version: 1, generatedAt, items, ledger: combinedLedger });
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

async function writeReport(outputDir, meta, noFeedback, interviewFailed, screeningFailed, screenshots) {
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
    ['判定规则', '沉默只归为无反馈；只有截图或面试日历存在明确否定结论才归为未通过。'],
    ['同步说明', 'AI 只自动落实能够唯一关联候选人和岗位的结果；不能唯一定位的消息保留在逐消息台账，不产生人工待办。'],
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
  const reuseOcr = hasFlag('--reuse-ocr');

  // Telegram 会话只用于拉取消息和截图。先把需要识别的图片下载到本地，
  // 随后立即断开，让常驻发送器恢复；耗时的 OCR 不再长期占用同一会话。
  const prepared = await runPool(imageEntries.map(({ message, index }) => async () => {
    const extension = imageExtension(message);
    const baseName = `msg-${message.id}`;
    const imagePath = path.join(imageDir, `${baseName}${extension}`);
    const cachePath = path.join(cacheDir, `${baseName}.json`);
    const context = contextFor(messages, index, accountLabel);
    if (!force && fs.existsSync(cachePath)) {
      const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
      if (cached.promptVersion === PROMPT_VERSION || (reuseOcr && (cached.rawText || cached.items?.length))) {
        return { cached: { ...cached, ...sanitizeVisionResult(cached), promptVersion: PROMPT_VERSION, context } };
      }
    }
    try {
      const buffer = Buffer.from(await client.downloadMedia(message, {}));
      fs.writeFileSync(imagePath, buffer);
      return { buffer, extension, imagePath, cachePath, context, message };
    } catch (error) {
      return {
        failed: {
          promptVersion: PROMPT_VERSION,
          model: VISION_MODEL,
          messageId: String(message.id),
          feedbackAt: shanghaiDateTime(messageDate(message)),
          imagePath,
          context,
          rawText: '',
          items: [],
          error: clean(error?.message || error),
        },
      };
    }
  }), Math.max(1, Number.parseInt(arg('--concurrency', '2'), 10)));
  await client.disconnect();
  console.log(`__TG_SESSION_RELEASED__:${owner}`);

  const [repushRaw, candidatesRaw] = await Promise.all([kvGet('recruit:repush'), kvGet('recruit:candidates')]);
  const allRecommendations = parseStored(repushRaw, []);
  const candidates = parseStored(candidatesRaw, []);
  const ownerRecommendations = dedupeRecommendations(allRecommendations.filter((item) => item.column === owner));
  const recommendations = ownerRecommendations.filter((item) => {
    const date = recommendationDate(item);
    return date && date >= from && date <= to;
  });

  const tasks = prepared.map((entry, index) => async () => {
    const sourceMessage = entry.message || imageEntries[index].message;
    const sourceIndex = imageEntries[index].index;
    const referenceContext = referenceContextFor(messages, sourceIndex, accountLabel, ownerRecommendations);
    const context = contextFor(messages, sourceIndex, accountLabel, referenceContext);
    if (entry.cached) return { ...entry.cached, context, referenceContext, sourceType: 'image' };
    if (entry.failed) return { ...entry.failed, context, referenceContext, sourceType: 'image' };
    if (!entry.buffer) {
      return {
        promptVersion: PROMPT_VERSION,
        model: VISION_MODEL,
        messageId: String(sourceMessage.id),
        feedbackAt: shanghaiDateTime(messageDate(sourceMessage)),
        imagePath: clean(entry.imagePath),
        context,
        referenceContext,
        rawText: '',
        items: [],
        sourceType: 'image',
        error: clean(entry.error || 'Telegram screenshot download failed'),
      };
    }
    let result;
    try {
      result = await recognizeScreenshot(entry.buffer, entry.extension, context, referenceContext);
    } catch (error) {
      return {
        promptVersion: PROMPT_VERSION,
        model: VISION_MODEL,
        messageId: String(sourceMessage.id),
        feedbackAt: shanghaiDateTime(messageDate(sourceMessage)),
        imagePath: entry.imagePath,
        context,
        referenceContext,
        rawText: '',
        items: [],
        sourceType: 'image',
        error: clean(error?.message || error),
      };
    }
    const record = {
      promptVersion: PROMPT_VERSION,
      model: VISION_MODEL,
      messageId: String(sourceMessage.id),
      feedbackAt: shanghaiDateTime(messageDate(sourceMessage)),
      imagePath: entry.imagePath,
      context,
      referenceContext,
      sourceType: 'image',
      ...result,
    };
    fs.writeFileSync(entry.cachePath, JSON.stringify(record, null, 2));
    return record;
  });
  const recognizedScreenshots = await runPool(tasks, Math.max(1, Number.parseInt(arg('--concurrency', '2'), 10)));
  const textEntries = messages
    .map((message, index) => ({ message, index, text: clean(message.message) }))
    .filter(({ message, text }) => !message.out && !isImageMessage(message) && text);
  const textTasks = textEntries.flatMap(({ message, index, text }) => {
    const referenceContext = referenceContextFor(messages, index, accountLabel, ownerRecommendations);
    const context = contextFor(messages, index, accountLabel, referenceContext);
    if (!isPotentialRecruitingText(text, referenceContext, ownerRecommendations)) return [];
    return [async () => {
      const cachePath = path.join(cacheDir, `msg-${message.id}-text.json`);
      if (!force && fs.existsSync(cachePath)) {
        const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
        if (cached.promptVersion === PROMPT_VERSION || (reuseOcr && (cached.rawText || cached.items?.length))) {
          return { ...cached, ...sanitizeVisionResult(cached), promptVersion: PROMPT_VERSION, context, referenceContext, sourceType: 'text' };
        }
      }
      try {
        const result = await recognizeTextMessage(text, context, referenceContext);
        const record = {
          promptVersion: PROMPT_VERSION,
          model: VISION_MODEL,
          messageId: String(message.id),
          feedbackAt: shanghaiDateTime(messageDate(message)),
          imagePath: '',
          context,
          referenceContext,
          sourceType: 'text',
          ...result,
        };
        fs.writeFileSync(cachePath, JSON.stringify(record, null, 2));
        return record;
      } catch (error) {
        return {
          promptVersion: PROMPT_VERSION,
          model: VISION_MODEL,
          messageId: String(message.id),
          feedbackAt: shanghaiDateTime(messageDate(message)),
          imagePath: '',
          context,
          referenceContext,
          rawText: text,
          items: [],
          sourceType: 'text',
          error: clean(error?.message || error),
        };
      }
    }];
  });
  const recognizedTexts = await runPool(textTasks, Math.max(1, Number.parseInt(arg('--concurrency', '2'), 10)));
  const recognized = [...recognizedScreenshots, ...recognizedTexts];
  const messageById = new Map(messages.map((message) => [String(message.id), message]));

  const screenshotRows = [];
  const unresolvedByMessage = new Map();
  const noteUnresolved = (messageId, note) => {
    const key = String(messageId || '');
    if (!key || unresolvedByMessage.has(key)) return;
    unresolvedByMessage.set(key, clean(note));
  };
  const feedbackByRecommendation = new Map();
  for (let index = 0; index < recognized.length; index += 1) {
    const record = recognized[index] || {};
    const sourceMessage = messageById.get(String(record.messageId));
    const originalItems = Array.isArray(record.items) ? record.items : [];
    const inferredItem = originalItems.length || record.sourceType === 'text'
      ? null
      : inferItemFromRecord(record, ownerRecommendations);
    if (record.error && !inferredItem) {
      const row = {
        messageId: String(record.messageId || sourceMessage?.id || ''),
        feedbackAt: record.feedbackAt || (sourceMessage ? shanghaiDateTime(messageDate(sourceMessage)) : ''),
        imagePath: clean(record.imagePath), context: clean(record.context), error: record.error,
        sourceType: record.sourceType || 'image',
      };
      screenshotRows.push(row);
      continue;
    }
    const workingRecord = {
      ...record,
      error: inferredItem ? undefined : record.error,
      items: originalItems.length ? originalItems : inferredItem ? [inferredItem] : [],
    };
    if (!workingRecord.items.length) {
      screenshotRows.push({ ...record, result: '无候选人条目' });
      if (clean(record.rawText)) noteUnresolved(record.messageId, 'AI 未识别出可落实的候选人结论，原消息已保留');
      continue;
    }
    for (const item of workingRecord.items) {
      const enrichedItem = enrichVisionItem(item, workingRecord);
      const normalizedItem = inferIdentityFromContext(enrichedItem, workingRecord, ownerRecommendations);
      const row = { ...workingRecord, ...normalizedItem };
      delete row.items;
      screenshotRows.push(row);
      if (!codeBelongsToOwner(normalizedItem.candidateCode, owner)) {
        noteUnresolved(record.messageId, `候选人编码不属于${accountLabel}，已隔离且未归档`);
        continue;
      }
      const matchingText = workingRecord.items.length === 1
        ? workingRecord.rawText
        : clean(`${normalizedItem.feedbackSummary} ${normalizedItem.evidence}`);
      const referencedRecommendation = recommendationReference(workingRecord.referenceContext, ownerRecommendations);
      const normalizedCode = normalizeCode(normalizedItem.candidateCode);
      const itemNameKey = normalizeName(normalizedItem.candidateName);
      const referenceMatchesIdentity = referencedRecommendation && (
        (!normalizedCode && !itemNameKey)
        || (normalizedCode && normalizedCode === normalizeCode(referencedRecommendation.candidateCode))
        || (itemNameKey && candidateNamesMatch(itemNameKey, referencedRecommendation.candidateName))
      );
      const match = referencedRecommendation && referenceMatchesIdentity
        ? { recommendation: referencedRecommendation, score: 1, reason: '按回复或引用的推荐语唯一对应' }
        : matchFeedback(normalizedItem, ownerRecommendations, matchingText);
      const reliableMatch = match && !match.ambiguous && (
        match.score >= 0.95 || (match.score >= 0.75 && normalizedItem.confidence >= 0.55)
      );
      if (!reliableMatch) {
        noteUnresolved(
          record.messageId,
          match?.ambiguous
            ? '已读懂消息，但同一候选人存在多个岗位且缺少唯一定位信息，暂未归档'
            : '已读取消息，但没有找到唯一对应的推荐记录，暂未归档',
        );
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
    if (calendarFailure) {
      const screeningIndex = screeningFailed.findIndex((item) => item.recommendationId === rec.id);
      if (screeningIndex >= 0) screeningFailed.splice(screeningIndex, 1);
      if (!interviewFailed.some((item) => item.recommendationId === rec.id)) {
        interviewFailed.push(reportRow(rec, {
          interviewStage: clean(candidate?.stage),
          feedbackAt: clean(candidate?.updatedAt || candidate?.interviewDate),
          feedbackSummary: '面试日历已标记未通过',
          evidence: '企鹅岛面试日历 outcome=failed',
          confidence: 1,
          imagePath: '',
        }));
      }
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
  const resolvedByMessage = new Map();
  for (const [recommendationId, rows] of feedbackByRecommendation.entries()) {
    for (const row of rows) {
      const messageId = String(row.messageId || '');
      if (!messageId) continue;
      const ids = resolvedByMessage.get(messageId) || [];
      if (!ids.includes(recommendationId)) ids.push(recommendationId);
      resolvedByMessage.set(messageId, ids);
    }
  }
  const recordsByMessage = new Map(recognized.map((record) => [String(record.messageId || ''), record]));
  const ledger = messages.map((message) => {
    const messageId = String(message.id);
    const record = recordsByMessage.get(messageId);
    const recommendationIds = resolvedByMessage.get(messageId) || [];
    const sourceType = isImageMessage(message) ? 'image' : clean(message.message) ? 'text' : 'other';
    let status = 'irrelevant';
    let note = '未发现需要归档的招聘反馈';
    if (message.out) {
      status = 'context_only';
      note = '本方发送的消息，仅作为识别上下文';
    } else if (recommendationIds.length) {
      status = 'resolved';
      note = `已落实到 ${recommendationIds.length} 条推荐记录`;
    } else if (record?.error) {
      status = 'failed';
      note = clean(record.error);
    } else if (unresolvedByMessage.has(messageId)) {
      note = unresolvedByMessage.get(messageId);
    }
    return {
      id: `${owner}:tg:${messageId}`,
      owner,
      telegramMessageId: messageId,
      sentAt: shanghaiDateTime(messageDate(message)),
      direction: message.out ? 'outgoing' : 'incoming',
      sourceType,
      status,
      preview: clean(message.message || record?.rawText || (sourceType === 'image' ? '[反馈截图]' : '[附件]')).slice(0, 240),
      note,
      extractedItemCount: Array.isArray(record?.items) ? record.items.length : 0,
      recommendationIds,
    };
  });
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
    reviewCount: 0,
    ledgerCount: ledger.length,
    resolvedMessageCount: ledger.filter((item) => item.status === 'resolved').length,
    reviewMessageCount: 0,
  };
  const feedbackInboxCount = hasFlag('--sync')
    ? await syncFeedbackInbox(owner, meta, noFeedback, scheduledFeedback, interviewFailed, screeningFailed, ledger)
    : 0;
  const workbookPath = await writeReport(outputRoot, meta, noFeedback, interviewFailed, screeningFailed, screenshotRows);
  fs.writeFileSync(path.join(outputRoot, '复推反馈审计.json'), JSON.stringify({ meta, noFeedback, scheduledFeedback, interviewFailed, screeningFailed, review: [], ledger, screenshots: screenshotRows }, null, 2));
  console.log(JSON.stringify({ ok: true, ...meta, feedbackInboxCount, workbookPath }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: clean(error?.message || error) }));
  process.exitCode = 1;
});
