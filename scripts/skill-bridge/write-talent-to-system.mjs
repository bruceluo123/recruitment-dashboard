#!/usr/bin/env node
// 把「人才录入」结果直接写入企鹅求职岛系统的人才库（Upstash KV）。
// 系统是唯一数据源；本脚本按姓名 upsert，并用 KV CAS 与版本自增原子提交；
// 快照已变化时拒绝覆盖，由调用方基于最新数据重试。
//
// 供 zz-hunteragent-talent-entry skill 在整理好人选信息后调用：
//   node scripts/skill-bridge/write-talent-to-system.mjs --file talent.json
//   cat talent.json | node scripts/skill-bridge/write-talent-to-system.mjs
//
// talent.json 结构：
// {
//   "name": "张三",                    // 必填，按姓名 upsert（同名覆盖）
//   "jobTitle": "高级前端工程师",        // 选填，最近一份岗位 title
//   "categories": ["frontend"],        // 选填，复用 JD 分类体系
//   "tg": "@zhangsan",                 // 选填，TG 号
//   "notes": "5 年 React，看机会中",     // 选填，备注
//   "resumeUrl": "https://...",        // 选填，简历下载链接（已有 URL 时直接用）
//   "resumeFileName": "张三-简历.pdf",  // 选填，简历文件名
//   "resumeFilePath": "D:/.../张三.pdf",// 选填，本地简历文件路径 → 自动上传到 Vercel Blob 拿 URL
//   "resumeText": "整段简历正文……",     // 选填，已提取的简历正文 → 写入 KV，列表显示已扫描
//   // —— 结构化档案字段（Tier 2，均可选）——
//   "company": "字节跳动",              // 最近公司
//   "department": "AI Lab",            // 部门
//   "techDirection": "大模型-预训练",    // 技术方向（L 分类标签）
//   "eduLevel": "硕士",                 // 学历
//   "school": "清华大学",               // 毕业院校
//   "major": "计算机科学",              // 专业
//   "gradYear": "2020",                // 毕业时间
//   "location": "北京",                // 所在地
//   "prevCompanies": ["腾讯", "阿里"],  // 曾经任职公司
//   "email": "a@b.com",                // 邮箱
//   "phone": "138...",                 // 电话
//   "links": {                         // 外部主页/档案链接
//     "maimai": "...", "linkedin": "...", "github": "...",
//     "scholar": "...", "openreview": "...", "homepage": "..."
//   }
// }

const KV_URL = process.env.RECRUIT_KV_URL || '';
const KV_TOKEN = process.env.RECRUIT_KV_TOKEN || '';
const APP_URL = (process.env.RECRUIT_APP_URL || 'https://qieqiuzhidao.vercel.app').replace(/\/$/, '');
const APP_SERVICE_TOKEN = process.env.RECRUIT_SERVICE_TOKEN || process.env.SERVICE_API_TOKEN || '';
const TALENTS_KEY = 'recruit:talents';
const VERSION_KEY = 'recruit:version';
const TALENT_TEXT_PREFIX = 'recruit:talent-text:';

function genId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

async function kvGet(key) {
  const res = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
  if (!res.ok) throw new Error(`KV get ${key} failed: ${res.status}`);
  const data = await res.json();
  return data.result;
}

async function kvEval(script, keys, args) {
  const res = await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(['EVAL', script, keys.length, ...keys, ...args]),
  });
  if (!res.ok) throw new Error(`KV transaction failed: ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(`KV transaction failed: ${data.error}`);
  return data.result;
}

// 干净字符串：trim 后为空则返回 undefined（避免写入空串）
function clean(v) {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s ? s : undefined;
}

// 从 payload.links 里挑出有值的链接子集
function buildLinks(raw) {
  if (!raw || typeof raw !== 'object') return undefined;
  const keys = ['maimai', 'linkedin', 'github', 'scholar', 'openreview', 'homepage'];
  const out = {};
  for (const k of keys) {
    const v = clean(raw[k]);
    if (v) out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

// 上传本地简历文件到系统的 /api/talent/upload（Vercel Blob），返回 { url, fileName }
async function uploadResume(filePath) {
  if (!APP_SERVICE_TOKEN) throw new Error('缺少 RECRUIT_SERVICE_TOKEN，无法通过登录边界上传简历');
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const buf = await fs.readFile(filePath);
  const fileName = path.basename(filePath);
  const fd = new FormData();
  fd.append('file', new Blob([buf]), fileName);
  const res = await fetch(`${APP_URL}/api/talent/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${APP_SERVICE_TOKEN}` },
    body: fd,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.url) throw new Error(`简历上传失败：${data?.error || res.status}`);
  return { url: data.downloadUrl || data.url, fileName: data.fileName || fileName };
}

async function readPayload() {
  const fileIdx = process.argv.indexOf('--file');
  if (fileIdx !== -1 && process.argv[fileIdx + 1]) {
    const fs = await import('node:fs/promises');
    return JSON.parse(await fs.readFile(process.argv[fileIdx + 1], 'utf8'));
  }
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function main() {
  if (!KV_URL || !KV_TOKEN) {
    throw new Error('缺少 RECRUIT_KV_URL 或 RECRUIT_KV_TOKEN，已拒绝使用源码内置凭据');
  }
  const payload = await readPayload();
  if (!payload || !payload.name || !String(payload.name).trim()) {
    console.error('错误：缺少姓名 name');
    process.exit(1);
  }
  const name = String(payload.name).trim();
  const now = new Date().toISOString();

  const raw = await kvGet(TALENTS_KEY);
  let list = [];
  try { list = raw ? JSON.parse(raw) : []; } catch { throw new Error('人才库数据格式异常，已停止写入'); }
  if (!Array.isArray(list)) throw new Error('人才库数据格式异常，已停止写入');

  const idx = list.findIndex((t) => t && String(t.name || '').trim() === name);
  const targetId = idx !== -1 && list[idx].id ? list[idx].id : genId();

  // 简历文件：已有 resumeUrl 直接用；否则若给了本地路径就上传
  let resumeUrl = clean(payload.resumeUrl);
  let resumeFileName = clean(payload.resumeFileName);
  const resumeFilePath = clean(payload.resumeFilePath);
  if (!resumeUrl && resumeFilePath) {
    try {
      const up = await uploadResume(resumeFilePath);
      resumeUrl = up.url;
      resumeFileName = resumeFileName || up.fileName;
    } catch (err) {
      // 上传失败（如本机连不上 Vercel）不应中断整条录入：跳过文件，其余字段照常写入
      console.warn(`⚠️ 简历文件上传失败，已跳过（其余信息照常录入）：${err.message}`);
      if (!resumeFileName && resumeFilePath) {
        const path = await import('node:path');
        resumeFileName = path.basename(resumeFilePath);
      }
    }
  }

  const prevCompanies = Array.isArray(payload.prevCompanies)
    ? payload.prevCompanies.map((s) => clean(s)).filter(Boolean)
    : undefined;

  const fields = {
    name,
    jobTitle: payload.jobTitle ? String(payload.jobTitle).trim() : '',
    categories: Array.isArray(payload.categories) ? payload.categories : [],
    tg: clean(payload.tg),
    notes: clean(payload.notes),
    resumeUrl,
    resumeFileName,
    company: clean(payload.company),
    department: clean(payload.department),
    techDirection: clean(payload.techDirection),
    eduLevel: clean(payload.eduLevel),
    school: clean(payload.school),
    major: clean(payload.major),
    gradYear: clean(payload.gradYear),
    location: clean(payload.location),
    prevCompanies: prevCompanies && prevCompanies.length ? prevCompanies : undefined,
    email: clean(payload.email),
    phone: clean(payload.phone),
    links: buildLinks(payload.links),
    // 飞书表对齐补充字段
    recruiter: clean(payload.recruiter),
    firstContactAt: clean(payload.firstContactAt),
    lastContactAt: clean(payload.lastContactAt),
    workIntent: clean(payload.workIntent),
    projectIntent: clean(payload.projectIntent),
    monthlySalary: clean(payload.monthlySalary),
    annualSalary: clean(payload.annualSalary),
    bachelorGradYear: clean(payload.bachelorGradYear),
    level: clean(payload.level),
    wechatStatus: clean(payload.wechatStatus),
    outreachStatus: clean(payload.outreachStatus),
    friendTrack: clean(payload.friendTrack),
    account: clean(payload.account),
    onboardInfo: clean(payload.onboardInfo),
    techAccount: clean(payload.techAccount),
  };

  // 简历正文：写入独立 KV 文字键，并在列表项标记已扫描 + 字数
  const resumeText = typeof payload.resumeText === 'string' ? payload.resumeText : '';
  if (resumeText.trim()) {
    fields.hasResumeText = true;
    fields.resumeChars = resumeText.replace(/\s+/g, '').length;
  }

  let action;
  if (idx !== -1) {
    // 增量更新：只覆盖本次提供了值的字段，未提供（undefined）的保留原值，避免抹掉已有数据。
    // categories 仅在本次给了非空数组时才覆盖。
    const patch = {};
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined) continue;
      if (k === 'categories' && (!Array.isArray(v) || v.length === 0)) continue;
      patch[k] = v;
    }
    list[idx] = { ...list[idx], ...patch, id: targetId, updatedAt: now };
    action = '更新';
  } else {
    list.unshift({ id: targetId, createdAt: now, updatedAt: now, ...fields });
    action = '新建';
  }

  const textKey = `${TALENT_TEXT_PREFIX}${targetId}`;
  const keys = resumeText.trim() ? [TALENTS_KEY, VERSION_KEY, textKey] : [TALENTS_KEY, VERSION_KEY];
  const [committed, v] = await kvEval(`
if (redis.call('GET', KEYS[1]) or '') ~= ARGV[1] then
  return {0, tonumber(redis.call('GET', KEYS[2]) or '0')}
end
redis.call('SET', KEYS[1], ARGV[2])
if KEYS[3] then redis.call('SET', KEYS[3], ARGV[3]) end
local version = redis.call('INCR', KEYS[2])
return {1, version}`, keys, [raw || '', JSON.stringify(list), ...(resumeText.trim() ? [resumeText] : [])]);
  if (Number(committed) !== 1) throw new Error('人才库在写入期间已更新，本轮未覆盖；请重试');

  console.log(`✅ 已${action}人选「${name}」到系统人才库（version=${Number(v)}，共 ${list.length} 人）`);
  console.log('   打开 https://qieqiuzhidao.vercel.app/talent-pool 查看');
}

main().catch((err) => { console.error('写入失败：', err.message); process.exit(1); });
