// JD 恢复：1) 按岗位名去重，同名保留富内容版、删空壳；2) 空壳的职责/要求从最近的富快照按岗位名回填。
// 默认 DRY RUN（只统计不写入）。加 --apply 才真正写回 KV，并先把当前 live 存到一个恢复点备份键。
import fs from 'node:fs';
const APPLY = process.argv.includes('--apply');
const env = fs.readFileSync('.env.local', 'utf8');
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim().replace(/^["']|["']$/g, '');
const KV = get('KV_REST_API_URL'), TOK = get('KV_REST_API_TOKEN');
async function kvGet(key) {
  const res = await fetch(`${KV}/get/${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${TOK}` } });
  if (!res.ok) return null; const d = await res.json(); return d.result == null ? null : String(d.result);
}
async function kvSet(key, val) {
  const res = await fetch(`${KV}/set/${encodeURIComponent(key)}`, { method: 'POST', headers: { Authorization: `Bearer ${TOK}`, 'Content-Type': 'text/plain' }, body: val });
  return res.ok;
}
const hasResp = (j) => Array.isArray(j.responsibilities) && j.responsibilities.length > 0;
const hasReq = (j) => Array.isArray(j.requirements) && j.requirements.length > 0;
const rich = (j) => hasResp(j) || hasReq(j);
const norm = (s) => (s || '').trim();

const live = JSON.parse(await kvGet('recruit:jds'));

// 收集所有快照里按岗位名的最佳富内容（职责/要求分别取最长的）。
const snapDates = ['2026-06-18','2026-06-17','2026-06-16','2026-06-15','2026-06-14','2026-06-13','2026-06-12','2026-06-11'];
const bestResp = new Map(), bestReq = new Map();
const consider = (list) => { for (const j of list) {
  const t = norm(j.title);
  if (hasResp(j) && (!bestResp.has(t) || j.responsibilities.join('').length > bestResp.get(t).join('').length)) bestResp.set(t, j.responsibilities);
  if (hasReq(j) && (!bestReq.has(t) || j.requirements.join('').length > bestReq.get(t).join('').length)) bestReq.set(t, j.requirements);
}};
consider(live);
for (const d of snapDates) { const raw = await kvGet(`recruit:backup:jds:${d}`); if (raw) { try { consider(JSON.parse(raw)); } catch {} } }

// 按岗位名去重：每个 title 选一个代表（优先富内容、其次带 status/最新），再回填职责要求。
const byTitle = new Map();
for (const j of live) { const t = norm(j.title); if (!byTitle.has(t)) byTitle.set(t, []); byTitle.get(t).push(j); }
const out = [];
let backfilledResp = 0, backfilledReq = 0, droppedStubs = 0;
for (const [t, list] of byTitle) {
  const richOnes = list.filter(rich);
  const rep = (richOnes[0] || list[0]);
  droppedStubs += list.length - 1;
  const next = { ...rep };
  if (!hasResp(next) && bestResp.has(t)) { next.responsibilities = bestResp.get(t); backfilledResp++; }
  if (!hasReq(next) && bestReq.has(t)) { next.requirements = bestReq.get(t); backfilledReq++; }
  out.push(next);
}
// 计算被删除的条目 id（live 中有但结果中没有）→ 这些必须写入墓碑，
// 否则客户端 localStorage 仍持有这些 id，下次 push 会按 id 合并把空壳重新带回。
const keptIds = new Set(out.map((j) => j.id).filter(Boolean));
const droppedIds = live.map((j) => j.id).filter((id) => id && !keptIds.has(id));

console.log(APPLY ? '== APPLY ==' : '== DRY RUN ==');
console.log('live 原条目:', live.length, '→ 去重后:', out.length, '（删除重复/空壳:', droppedStubs, '）');
console.log('回填职责的岗位:', backfilledResp, ' 回填要求的岗位:', backfilledReq);
console.log('结果中有职责:', out.filter(hasResp).length, ' 有要求:', out.filter(hasReq).length);
console.log('结果中仍空壳:', out.filter((j) => !rich(j)).length);
console.log('将写入墓碑的删除 id 数:', droppedIds.length);

if (APPLY) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const ok1 = await kvSet(`recruit:backup:jds:pre-recover-${stamp}`, JSON.stringify(live));
  console.log('已保存恢复点备份 recruit:backup:jds:pre-recover-' + stamp + ':', ok1);
  const ok2 = await kvSet('recruit:jds', JSON.stringify(out));
  console.log('已写回 recruit:jds:', ok2);

  // 写墓碑：合并到现有 recruit:tombstones 的 jds 段（沿用 sync.ts 的 {type:{id:ts}} 结构）
  const TOMB_KEY = 'recruit:tombstones';
  const now = Date.now();
  let tomb = {};
  try { tomb = JSON.parse((await kvGet(TOMB_KEY)) || '{}') || {}; } catch {}
  const jdTomb = { ...(tomb.jds || {}) };
  for (const id of droppedIds) jdTomb[id] = now;
  tomb = { ...tomb, jds: jdTomb };
  const ok3 = await kvSet(TOMB_KEY, JSON.stringify(tomb));
  console.log('已写入墓碑（jds 段共', Object.keys(jdTomb).length, '个 id）:', ok3);

  // 提升全局版本号，促使所有在线客户端在下次轮询时采用清理后的状态
  const curV = parseInt((await kvGet('recruit:version')) || '0') || 0;
  const ok4 = await kvSet('recruit:version', String(curV + 1));
  console.log('已提升 recruit:version', curV, '→', curV + 1, ':', ok4);
}
