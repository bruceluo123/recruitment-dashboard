#!/usr/bin/env node
// 把「公司研究」结果直接写入企鹅求职岛系统的公司库（Upstash KV）。
// 系统是唯一数据源；本脚本按公司名 upsert，并用 KV CAS 与版本自增原子提交；
// 快照已变化时拒绝覆盖，由调用方基于最新数据重试。
//
// 供 zz-hunteragent-company-research skill 在 11 维度研究完成后调用：
//   node scripts/skill-bridge/write-company-to-system.mjs --file company.json
//   cat company.json | node scripts/skill-bridge/write-company-to-system.mjs
//
// company.json 结构（11 维度公司研究）：
// {
//   "name": "某某公司",                 // 必填，按公司名 upsert（同名覆盖研究内容）
//   "industry": "AI",                  // 选填
//   "categories": ["ai","algorithm"],  // 选填，关联岗位分类（与 JD 分类同体系）
//   "summary": "一句话备注（非投资判断）",  // 选填
//   "researchedBy": "花名",            // 选填
//   "relatedReqKeys": ["REQ-123"],     // 选填，关联 JD 的 reqKey
//   "dims": [                          // 11 个维度，key 1..11
//     { "key": 1, "title": "公司基本盘", "body": "...", "sources": [{ "title": "来源", "url": "https://..." }] }
//   ]
// }

const KV_URL = process.env.RECRUIT_KV_URL || '';
const KV_TOKEN = process.env.RECRUIT_KV_TOKEN || '';
const COMPANIES_KEY = 'recruit:companies';
const VERSION_KEY = 'recruit:version';

const DIM_TITLES = [
  '公司基本盘', '团队和老板', '赛道和市场', '时机和产业周期', '客户痛点',
  '产品/服务/业务闭环和近一年动作', '商业模式', '增长状态', '竞争位置', '护城河', '风险和负面',
];

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

function normalizeDims(input) {
  const arr = Array.isArray(input) ? input : [];
  return DIM_TITLES.map((title, i) => {
    const found = arr.find((d) => Number(d.key) === i + 1) || arr[i] || {};
    const sources = Array.isArray(found.sources)
      ? found.sources.map((s) => ({ title: String(s.title || ''), url: String(s.url || '') })).filter((s) => s.url || s.title)
      : [];
    return { key: i + 1, title, body: String(found.body || '').trim(), sources };
  });
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
  if (!KV_URL || !KV_TOKEN) throw new Error('缺少 RECRUIT_KV_URL 或 RECRUIT_KV_TOKEN');
  const payload = await readPayload();
  if (!payload || !payload.name || !String(payload.name).trim()) {
    console.error('错误：缺少公司名 name');
    process.exit(1);
  }
  const name = String(payload.name).trim();
  const now = new Date().toISOString();

  const raw = await kvGet(COMPANIES_KEY);
  let list = [];
  try { list = raw ? JSON.parse(raw) : []; } catch { throw new Error('公司库数据格式异常，已停止写入'); }
  if (!Array.isArray(list)) throw new Error('公司库数据格式异常，已停止写入');

  const fields = {
    name,
    industry: payload.industry ? String(payload.industry).trim() : undefined,
    categories: Array.isArray(payload.categories) ? payload.categories : [],
    summary: payload.summary ? String(payload.summary).trim() : undefined,
    researchedBy: payload.researchedBy ? String(payload.researchedBy).trim() : undefined,
    relatedReqKeys: Array.isArray(payload.relatedReqKeys) ? payload.relatedReqKeys : undefined,
    dims: normalizeDims(payload.dims),
  };

  const idx = list.findIndex((c) => c && String(c.name || '').trim() === name);
  let action;
  if (idx !== -1) {
    list[idx] = { ...list[idx], ...fields, updatedAt: now };
    action = '更新';
  } else {
    list.unshift({ id: genId(), createdAt: now, updatedAt: now, ...fields });
    action = '新建';
  }

  const [committed, v] = await kvEval(`
if (redis.call('GET', KEYS[1]) or '') ~= ARGV[1] then
  return {0, tonumber(redis.call('GET', KEYS[2]) or '0')}
end
redis.call('SET', KEYS[1], ARGV[2])
local version = redis.call('INCR', KEYS[2])
return {1, version}`, [COMPANIES_KEY, VERSION_KEY], [raw || '', JSON.stringify(list)]);
  if (Number(committed) !== 1) throw new Error('公司库在写入期间已更新，本轮未覆盖；请重试');

  console.log(`✅ 已${action}公司「${name}」到系统公司库（version=${Number(v)}，共 ${list.length} 家）`);
  console.log('   打开 https://qieqiuzhidao.vercel.app/companies 查看');
}

main().catch((err) => { console.error('写入失败：', err.message); process.exit(1); });
