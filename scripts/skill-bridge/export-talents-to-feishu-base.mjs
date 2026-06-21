#!/usr/bin/env node
// 把系统人才库（Upstash KV）的人选写入飞书「多维表格 / Base / Bitable」。
// 与 export-talents-to-feishu.mjs（普通表格 /sheets/）区分：这条专门处理 /base/ 地址，
// 走 lark-cli base +record-batch-create，按【字段名】映射（不是固定列序）。
//
// 为什么走本地：从国内访问 Vercel 不稳定，KV REST + 本地 lark-cli 都通。
//
// 用法：
//   node scripts/skill-bridge/export-talents-to-feishu-base.mjs --url "<base url>"
//   node scripts/skill-bridge/export-talents-to-feishu-base.mjs --url "<base url>" --dry-run
//   node scripts/skill-bridge/export-talents-to-feishu-base.mjs --url "<base url>" --limit 5
//
// 选项：
//   --url       必填，飞书多维表格 URL（含 /base/<token>?table=<id>）
//   --dry-run   只打印将要创建的请求，不实际写
//   --limit N   只导出前 N 位（联调用）

const KV_URL = process.env.RECRUIT_KV_URL || 'https://positive-mongrel-70521.upstash.io';
const KV_TOKEN = process.env.RECRUIT_KV_TOKEN || 'gQAAAAAAARN5AAIgcDE5NDM2NzliZjdjOWY0MjBmYTA0NjhjODhjNTNjZjM3Zg';
const TALENTS_KEY = 'recruit:talents';
const BATCH_SIZE = 200; // lark-cli base +record-batch-create 单次上限

function s(v) {
  if (v === undefined || v === null) return '';
  return String(v).trim();
}

// 来源链接：把简历 + 外部主页合并成一段文本
function buildSourceLinks(t) {
  const links = t.links || {};
  const parts = [];
  if (t.resumeUrl) parts.push(`简历:${t.resumeUrl}`);
  if (links.maimai) parts.push(`脉脉:${links.maimai}`);
  if (links.linkedin) parts.push(`LinkedIn:${links.linkedin}`);
  if (links.github) parts.push(`GitHub:${links.github}`);
  if (links.scholar) parts.push(`Scholar:${links.scholar}`);
  if (links.openreview) parts.push(`OpenReview:${links.openreview}`);
  if (links.homepage) parts.push(`主页:${links.homepage}`);
  return parts.join('\n');
}

// 把任意时间串解析成飞书 datetime happy-path 格式 "yyyy-MM-dd HH:mm:ss"，解析失败返回 null
function toDateTime(v) {
  const raw = s(v);
  if (!raw) return null;
  const d = new Date(raw.replace(/\./g, '-').replace(/\//g, '-'));
  if (isNaN(d.getTime())) return null;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// 系统字段 → 飞书 Base 字段名 的取值函数（仅当目标表里真有该字段时才使用）
const FIELD_GETTERS = {
  '姓名': (t) => s(t.name),
  '岗位名称': (t) => s(t.jobTitle),
  '岗位方向/业务方向': (t) => s(t.techDirection),
  '所在公司': (t) => s(t.company),
  '所在部门': (t) => s(t.department),
  '级别': (t) => s(t.level),
  '学历': (t) => s(t.eduLevel),
  '专业': (t) => s(t.major),
  '毕业时间': (t) => s(t.gradYear),
  '本科毕业时间': (t) => s(t.bachelorGradYear),
  '所在地': (t) => s(t.location),
  '曾经在': (t) => (t.prevCompanies || []).map(s).filter(Boolean).join('、'),
  '手机': (t) => s(t.phone),
  '邮箱': (t) => s(t.email),
  '年薪': (t) => s(t.annualSalary),
  '招聘顾问': (t) => s(t.recruiter),
  '备注/沟通记录': (t) => s(t.notes),
  '来源链接': (t) => buildSourceLinks(t),
  '加微信': (t) => s(t.wechatStatus),
  '是否发站内信': (t) => s(t.outreachStatus),
  '添加好友轨迹': (t) => s(t.friendTrack),
  '工作意愿度': (t) => s(t.workIntent),       // select：取值后再校验是否在选项内
  '项目意愿度': (t) => s(t.projectIntent),    // select：同上
  '最新沟通日期': (t) => toDateTime(t.lastContactAt),
  '首次沟通日期': (t) => toDateTime(t.firstContactAt),
};

async function kvGet(key) {
  const res = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
  if (!res.ok) throw new Error(`KV get ${key} failed: ${res.status}`);
  const data = await res.json();
  return data.result;
}

function getArg(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

function parseBaseUrl(url) {
  const m = url.match(/\/base\/([A-Za-z0-9]+)/);
  const baseToken = m ? m[1] : null;
  const tableMatch = url.match(/[?&]table=([A-Za-z0-9]+)/);
  const tableId = tableMatch ? tableMatch[1] : null;
  return { baseToken, tableId };
}

async function larkRun(args) {
  const { spawn } = await import('node:child_process');
  return new Promise((resolve, reject) => {
    let out = '';
    const child = spawn('lark-cli', args, { shell: true });
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { process.stderr.write(c); });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(out) : reject(new Error(`lark-cli exit ${code}`)));
  });
}

async function fetchFields(baseToken, tableId) {
  const out = await larkRun([
    'base', '+field-list', '--as', 'user',
    '--base-token', baseToken, '--table-id', tableId, '--format', 'json',
  ]);
  const data = JSON.parse(out);
  return (data?.data?.fields || []).map((f) => ({
    name: f.name,
    type: f.type,
    options: Array.isArray(f.options) ? f.options.map((o) => o.name) : null,
  }));
}

async function batchCreate(baseToken, tableId, fieldNames, rows, dryRun) {
  const payload = JSON.stringify({ fields: fieldNames, rows });
  // 用临时文件传 JSON（--json @file），避免 Windows 命令行对中文/引号的转义问题。
  // lark-cli 要求 @file 必须是当前目录下的相对路径，所以写到 cwd。
  const fs = await import('node:fs/promises');
  const rel = `./.lark-batch-${Date.now()}.json`;
  await fs.writeFile(rel, payload, 'utf8');
  const finalArgs = [
    'base', '+record-batch-create', '--as', 'user',
    '--base-token', baseToken, '--table-id', tableId,
    '--json', `@${rel}`,
  ];
  if (dryRun) finalArgs.push('--dry-run');
  try {
    const out = await larkRun(finalArgs);
    return out;
  } finally {
    await fs.rm(rel, { force: true });
  }
}

async function main() {
  const url = getArg('--url');
  if (!url) { console.error('错误：缺少 --url（飞书多维表格地址）'); process.exit(1); }
  const { baseToken, tableId } = parseBaseUrl(url);
  if (!baseToken || !tableId) {
    console.error('错误：无法从 URL 解析 base-token 或 table-id。期望形如 /base/<token>?table=<id>');
    process.exit(1);
  }
  const dryRun = process.argv.includes('--dry-run');
  const limit = parseInt(getArg('--limit', '0'), 10) || 0;

  console.log(`目标 Base: ${baseToken}  Table: ${tableId}`);
  const fields = await fetchFields(baseToken, tableId);
  const fieldByName = new Map(fields.map((f) => [f.name, f]));

  // 只导出「系统有映射」且「目标表里真有」的字段
  const cols = Object.keys(FIELD_GETTERS)
    .filter((name) => fieldByName.has(name))
    .map((name) => ({ name, field: fieldByName.get(name), get: FIELD_GETTERS[name] }));

  console.log(`命中字段（${cols.length}）：${cols.map((c) => c.name).join('、')}`);
  const skipped = Object.keys(FIELD_GETTERS).filter((n) => !fieldByName.has(n));
  if (skipped.length) console.log(`系统有值但目标表无此列（跳过）：${skipped.join('、')}`);

  const raw = await kvGet(TALENTS_KEY);
  let list = [];
  try { list = raw ? JSON.parse(raw) : []; } catch { list = []; }
  if (!Array.isArray(list)) list = [];
  if (limit > 0) list = list.slice(0, limit);
  if (list.length === 0) { console.log('人才库为空，无可导出。'); return; }

  const fieldNames = cols.map((c) => c.name);
  const rows = list.map((t) => cols.map((c) => {
    let v = c.get(t);
    if (v === '' || v === undefined) v = null;
    // select 字段：值不在选项内就置空，避免整批失败
    if (v !== null && c.field.type === 'select' && c.field.options && !c.field.options.includes(v)) v = null;
    return v;
  }));

  console.log(`准备写入 ${rows.length} 条记录，分 ${Math.ceil(rows.length / BATCH_SIZE)} 批（每批≤${BATCH_SIZE}）。`);
  if (dryRun) {
    console.log('— dry-run 样例（前 2 条）—');
    console.log('fields:', JSON.stringify(fieldNames, null, 0));
    console.log('rows[0..1]:', JSON.stringify(rows.slice(0, 2), null, 2));
  }

  let created = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE);
    await batchCreate(baseToken, tableId, fieldNames, chunk, dryRun);
    created += chunk.length;
    console.log(`${dryRun ? '[dry-run] ' : ''}批 ${Math.floor(i / BATCH_SIZE) + 1}：${chunk.length} 条（累计 ${created}）`);
  }
  console.log(`${dryRun ? '（dry-run，未实际写入）' : `✅ 已写入 ${created} 条记录到飞书多维表格`}`);
}

main().catch((err) => { console.error('导出失败：', err.message); process.exit(1); });
