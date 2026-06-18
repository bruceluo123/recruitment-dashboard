// 只读诊断：分析 live recruit:jds 的重复与空壳情况。
import fs from 'node:fs';
const env = fs.readFileSync('.env.local', 'utf8');
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim().replace(/^["']|["']$/g, '');
const KV = get('KV_REST_API_URL'), TOK = get('KV_REST_API_TOKEN');
async function kvGet(key) {
  const res = await fetch(`${KV}/get/${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${TOK}` } });
  if (!res.ok) return null; const d = await res.json(); return d.result == null ? null : String(d.result);
}
const arr = JSON.parse(await kvGet('recruit:jds'));
const rich = (j) => (Array.isArray(j.responsibilities) && j.responsibilities.length) || (Array.isArray(j.requirements) && j.requirements.length);
const byTitle = new Map();
for (const j of arr) {
  const t = (j.title || '').trim();
  if (!byTitle.has(t)) byTitle.set(t, []);
  byTitle.get(t).push(j);
}
let titlesWithBoth = 0, stubsRecoverable = 0, pureStubTitles = 0, pureStubCount = 0;
for (const [t, list] of byTitle) {
  const richOnes = list.filter(rich); const stubs = list.filter((j) => !rich(j));
  if (richOnes.length && stubs.length) { titlesWithBoth++; stubsRecoverable += stubs.length; }
  else if (!richOnes.length && stubs.length) { pureStubTitles++; pureStubCount += stubs.length; }
}
console.log('live 总数:', arr.length);
console.log('唯一岗位名:', byTitle.size);
console.log('有富内容的岗位条目:', arr.filter(rich).length);
console.log('空壳条目:', arr.filter((j) => !rich(j)).length);
console.log('—— 同名既有富内容又有空壳的岗位数:', titlesWithBoth, '（可删空壳的条目:', stubsRecoverable, '）');
console.log('—— 只有空壳、无任何富内容的岗位名数:', pureStubTitles, '（条目:', pureStubCount, '）');
// reqKey 维度
const withReqKey = arr.filter((j) => j.reqKey && String(j.reqKey).trim()).length;
console.log('带 reqKey 的条目:', withReqKey, '/', arr.length);
