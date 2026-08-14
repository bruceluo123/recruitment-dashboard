#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { put } from '@vercel/blob';

const ROOT = process.cwd();
const ENV_PATH = path.join(ROOT, '.env.local');

function loadEnv() {
  if (!fs.existsSync(ENV_PATH)) return;
  const raw = fs.readFileSync(ENV_PATH, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([^#][^=]+)=\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1].trim();
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
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

function shanghaiDayStart(day) {
  return new Date(`${day}T00:00:00+08:00`);
}

function shanghaiTodayKey() {
  const d = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000);
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

function localDateKey(iso) {
  const d = new Date(new Date(iso).getTime() + 8 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

async function kvGet(key) {
  const res = await fetch(`${process.env.KV_REST_API_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}` },
  });
  if (!res.ok) throw new Error(`KV get ${key} failed: ${res.status}`);
  return (await res.json()).result;
}

async function kvSet(key, value) {
  const res = await fetch(`${process.env.KV_REST_API_URL}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.KV_REST_API_TOKEN}`, 'Content-Type': 'text/plain' },
    body: value,
  });
  if (!res.ok) throw new Error(`KV set ${key} failed: ${res.status} ${await res.text()}`);
}

async function parseResumeFromBlob(url, fileName) {
  const appUrl = (process.env.RECRUIT_APP_URL || 'https://qieqiuzhidao.vercel.app').replace(/\/$/, '');
  const res = await fetch(`${appUrl}/api/resume/parse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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
  return candidates[0]?.item || null;
}

async function collectTargets(client, from, to, limit) {
  const dialogs = await client.getDialogs({ limit: parseInt(arg('--dialog-limit', '500'), 10) });
  const groups = dialogs
    .filter((d) => {
      const title = String(d.title || d.name || '');
      return shouldScanGroupTitle(title);
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
      if (!isTargetCode(code)) continue;
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
  const dryRun = hasFlag('--dry-run');
  const write = hasFlag('--write');
  const limit = parseInt(arg('--limit', process.env.TG_SYNC_LIMIT || '180'), 10);
  const stateRaw = await kvGet('recruit:tg-resume-sync-state').catch(() => '');
  const state = stateRaw ? JSON.parse(stateRaw) : {};
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
  if (!process.env.TG_API_ID || !process.env.TG_API_HASH || !process.env.TG_SESSION) throw new Error('Missing TG API env.');
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) throw new Error('Missing KV env.');
  if (write && !process.env.BLOB_READ_WRITE_TOKEN) throw new Error('Missing BLOB_READ_WRITE_TOKEN.');

  const client = new TelegramClient(
    new StringSession((process.env.TG_SESSION || '').replace(/\s+/g, '')),
    parseInt(process.env.TG_API_ID || '', 10),
    process.env.TG_API_HASH || '',
    { connectionRetries: 3 },
  );
  await client.connect();
  let targets = [];
  try {
    targets = await collectTargets(client, from, to, limit);
  } finally {
    if (dryRun) await client.disconnect();
  }

  const ledgerRaw = await kvGet('recruit:tg-resume-sync-ledger').catch(() => '');
  let ledger = ledgerRaw ? JSON.parse(ledgerRaw) : [];
  if (!Array.isArray(ledger)) ledger = [];
  const doneKeys = new Set(ledger.map((row) => row.key));
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

  if (pending.length === 0) {
    try {
      await kvSet('recruit:tg-resume-sync-state', JSON.stringify({
        lastScanAt: to.toISOString(),
        lastRunAt: new Date().toISOString(),
        lastFound: targets.length,
        lastImported: 0,
      }));
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

  const talents = JSON.parse((await kvGet('recruit:talents')) || '[]');
  const repush = JSON.parse((await kvGet('recruit:repush')) || '[]');
  const codeLedgerRaw = await kvGet('recruit:candidate-code-ledger').catch(() => '');
  let codeLedger = codeLedgerRaw ? JSON.parse(codeLedgerRaw) : [];
  if (!Array.isArray(codeLedger)) codeLedger = [];

  const byTalentCode = new Map(talents.filter((t) => t?.candidateCode).map((t) => [String(t.candidateCode).toUpperCase(), t]));
  const byCodeLedger = new Map(codeLedger.filter((x) => x?.code).map((x) => [String(x.code).toUpperCase(), x]));
  const results = [];

  try {
    for (const target of pending) {
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

      const p = target.parsed;
      const code = target.code;
      const owner = code.includes('BB') ? 'BB' : 'MMF';
      const name = p.name || target.fileName.replace(/\.(pdf|docx?)$/i, '').split(/[-_]/)[0] || code;
      const jobTitle = p.jobTitle || '';
      const orgDept = splitOrgDept(p.organization);
      const rawText = [target.recommendationText, resumeText ? `\n\n--- resume text ---\n${resumeText}` : ''].filter(Boolean).join('');
      const cats = categories(jobTitle, rawText);
      const now = new Date().toISOString();

      let talent = byTalentCode.get(code);
      if (!talent) {
        talent = {
          id: genId(),
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
      if (resumeText) {
        await kvSet(`recruit:talent-text:${talent.id}`, resumeText);
        talent.hasResumeText = true;
        talent.resumeChars = resumeText.replace(/\s+/g, '').length;
      }

      let rec = findExistingRecommendation(repush, code, jobTitle, target.date);
      if (rec) {
        Object.assign(rec, {
          resumeUrl: uploaded.url,
          resumeFileName: target.fileName,
          rawText: rawText.slice(0, 2000),
          talentId: talent.id,
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
          feedback: 'pending',
          interviewStatus: 'none',
          organization: orgDept.organization,
          department: orgDept.department,
          uploadedAt: target.date,
        };
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
    }
  } finally {
    await client.disconnect();
  }

  codeLedger = [...byCodeLedger.values()].sort((a, b) => String(a.code).localeCompare(String(b.code)));
  await kvSet('recruit:talents', JSON.stringify(talents));
  await kvSet('recruit:repush', JSON.stringify(repush));
  await kvSet('recruit:tg-resume-sync-ledger', JSON.stringify(ledger.slice(-3000)));
  await kvSet('recruit:candidate-code-ledger', JSON.stringify(codeLedger));
  await kvSet('recruit:tg-resume-sync-state', JSON.stringify({
    lastScanAt: to.toISOString(),
    lastRunAt: new Date().toISOString(),
    lastFound: targets.length,
    lastImported: results.length,
  }));
  const rawVersion = await kvGet('recruit:version');
  const version = (parseInt(rawVersion || '0', 10) || 0) + 1;
  await kvSet('recruit:version', String(version));
  console.log(JSON.stringify({
    from: from.toISOString(),
    to: to.toISOString(),
    found: targets.length,
    imported: results.length,
    skipped: targets.length - pending.length,
    version,
    results,
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
