// 只读诊断：列出 KV 里 JD 备份快照，统计每个快照中带职责/要求的岗位数。
// 用法: node scripts/inspect-jd-backups.mjs
import fs from 'node:fs';

const env = fs.readFileSync('.env.local', 'utf8');
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim().replace(/^["']|["']$/g, '');
const KV = get('KV_REST_API_URL');
const TOK = get('KV_REST_API_TOKEN');
if (!KV || !TOK) { console.error('缺少 KV 凭据'); process.exit(1); }

async function kvGet(key) {
  const res = await fetch(`${KV}/get/${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${TOK}` } });
  if (!res.ok) return null;
  const d = await res.json();
  return d.result == null ? null : String(d.result);
}

function stats(raw) {
  if (!raw) return null;
  let arr;
  try { arr = JSON.parse(raw); } catch { return { parseError: true, bytes: raw.length }; }
  if (!Array.isArray(arr)) return { notArray: true };
  let withResp = 0, withReq = 0;
  for (const j of arr) {
    if (Array.isArray(j?.responsibilities) && j.responsibilities.length) withResp++;
    if (Array.isArray(j?.requirements) && j.requirements.length) withReq++;
  }
  return { total: arr.length, withResp, withReq };
}

const idxRaw = await kvGet('recruit:backup:index');
let dates = [];
try { dates = JSON.parse(idxRaw || '[]'); } catch {}
console.log('备份索引日期:', dates.join(', ') || '(空)');

console.log('\n--- live (recruit:jds) ---');
console.log(stats(await kvGet('recruit:jds')));
console.log('\n--- latest 备份 ---');
console.log(stats(await kvGet('recruit:backup:jds:latest')));

console.log('\n--- 每日快照 ---');
for (const d of dates.sort().reverse()) {
  console.log(d, stats(await kvGet(`recruit:backup:jds:${d}`)));
}
