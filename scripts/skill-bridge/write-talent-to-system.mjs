#!/usr/bin/env node
// 把「人才录入」结果直接写入企鹅求职岛系统的人才库（Upstash KV）。
// 系统是唯一数据源；本脚本走浏览器同款的 KV REST 直连读-改-写 + 版本号自增，
// 与 src/lib/sync.ts 的合并策略一致：按姓名 upsert、绝不整组覆盖，避免抹掉别人新增。
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
//   "resumeUrl": "https://...",        // 选填，简历下载链接
//   "resumeFileName": "张三-简历.pdf"   // 选填，简历文件名
// }

const KV_URL = process.env.RECRUIT_KV_URL || 'https://positive-mongrel-70521.upstash.io';
const KV_TOKEN = process.env.RECRUIT_KV_TOKEN || 'gQAAAAAAARN5AAIgcDE5NDM2NzliZjdjOWY0MjBmYTA0NjhjODhjNTNjZjM3Zg';
const TALENTS_KEY = 'recruit:talents';
const VERSION_KEY = 'recruit:version';

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

async function kvSet(key, value) {
  const res = await fetch(`${KV_URL}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'text/plain' },
    body: value,
  });
  if (!res.ok) throw new Error(`KV set ${key} failed: ${res.status}`);
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
  const payload = await readPayload();
  if (!payload || !payload.name || !String(payload.name).trim()) {
    console.error('错误：缺少姓名 name');
    process.exit(1);
  }
  const name = String(payload.name).trim();
  const now = new Date().toISOString();

  const raw = await kvGet(TALENTS_KEY);
  let list = [];
  try { list = raw ? JSON.parse(raw) : []; } catch { list = []; }
  if (!Array.isArray(list)) list = [];

  const fields = {
    name,
    jobTitle: payload.jobTitle ? String(payload.jobTitle).trim() : '',
    categories: Array.isArray(payload.categories) ? payload.categories : [],
    tg: payload.tg ? String(payload.tg).trim() : undefined,
    notes: payload.notes ? String(payload.notes).trim() : undefined,
    resumeUrl: payload.resumeUrl ? String(payload.resumeUrl).trim() : undefined,
    resumeFileName: payload.resumeFileName ? String(payload.resumeFileName).trim() : undefined,
  };

  const idx = list.findIndex((t) => t && String(t.name || '').trim() === name);
  let action;
  if (idx !== -1) {
    list[idx] = { ...list[idx], ...fields, updatedAt: now };
    action = '更新';
  } else {
    list.unshift({ id: genId(), createdAt: now, updatedAt: now, ...fields });
    action = '新建';
  }

  await kvSet(TALENTS_KEY, JSON.stringify(list));

  const rawV = await kvGet(VERSION_KEY);
  const v = (parseInt(rawV || '0', 10) || 0) + 1;
  await kvSet(VERSION_KEY, String(v));

  console.log(`✅ 已${action}人选「${name}」到系统人才库（version=${v}，共 ${list.length} 人）`);
  console.log('   打开 https://qieqiuzhidao.vercel.app/talent-pool 查看');
}

main().catch((err) => { console.error('写入失败：', err.message); process.exit(1); });
