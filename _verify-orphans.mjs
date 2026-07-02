import { readFileSync, writeFileSync } from 'node:fs';

const env = readFileSync('D:/projects/recruitment-dashboard/.env.local', 'utf8');
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim().replace(/^["']|["']$/g, '');
const KV_URL = get('RECRUIT_KV_URL') || get('KV_REST_API_URL') || 'https://positive-mongrel-70521.upstash.io';
const KV_TOKEN = get('RECRUIT_KV_TOKEN') || get('KV_REST_API_TOKEN');
const H = { Authorization: `Bearer ${KV_TOKEN}` };

// 带重试+超时的 fetch
async function rf(url, tries = 5, ms = 15000) {
  for (let i = 0; i < tries; i++) {
    try {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), ms);
      const r = await fetch(url, { headers: H, signal: c.signal });
      clearTimeout(t);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (i === tries - 1) throw e;
      await new Promise((res) => setTimeout(res, 1500 * (i + 1)));
    }
  }
}

// 1. 读孤儿清单，抽取每个孤儿 URL 的唯一随机后缀 token（编码无关）
const orphans = JSON.parse(readFileSync('D:/projects/recruitment-dashboard/_blob-orphans.json', 'utf8'));
// 唯一标识：url 最后一段去扩展名后的完整随机段。取 url 末尾文件名即可，随机后缀足够唯一。
const tokenOf = (o) => {
  const seg = decodeURIComponent(o.pathname.split('/').pop() || '');
  const m = seg.match(/-([A-Za-z0-9]{20,})\.[a-zA-Z0-9]+$/);
  return m ? m[1] : seg; // 优先随机后缀
};
const orphanTokens = orphans.map((o) => ({ o, token: tokenOf(o) }));
console.log(`孤儿数: ${orphans.length}, 抽取到唯一token: ${orphanTokens.filter((x) => x.token.length >= 20).length}`);

// 2. scan 所有 recruit: 键
let keys = [];
let cursor = '0';
do {
  const j = await rf(`${KV_URL}/scan/${cursor}/match/*/count/500`);
  cursor = j.result[0];
  keys = keys.concat(j.result[1]);
} while (cursor !== '0');
keys = [...new Set(keys)];
console.log(`KV 键总数: ${keys.length}`);
console.log(keys.map((k) => '  ' + k).join('\n'));

// 3. 用 pipeline 批量取值（每批 50 个 GET，一次 HTTP 往返），大幅减少慢链路的往返次数
const referencedElsewhere = new Map(); // token -> {pathname, keys[]}
const targetKeys = keys.filter((k) => k !== 'recruit:talents'); // talents 是孤儿定义基准，跳过
async function pipeline(cmds, tries = 5, ms = 30000) {
  for (let i = 0; i < tries; i++) {
    try {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), ms);
      const r = await fetch(`${KV_URL}/pipeline`, {
        method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
        body: JSON.stringify(cmds), signal: c.signal,
      });
      clearTimeout(t);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      if (i === tries - 1) throw e;
      await new Promise((res) => setTimeout(res, 1500 * (i + 1)));
    }
  }
}
const BATCH = 50;
let checked = 0;
for (let i = 0; i < targetKeys.length; i += BATCH) {
  const batch = targetKeys.slice(i, i + BATCH);
  const cmds = batch.map((k) => ['GET', k]);
  let results;
  try {
    results = await pipeline(cmds);
  } catch (e) {
    console.log(`!! 批次 ${i}-${i + batch.length} 取值失败(重试耗尽): ${e.message}`);
    process.exit(2); // 有键没验到，绝不删，退出让外层重跑
  }
  for (let j = 0; j < batch.length; j++) {
    const key = batch[j];
    const val = results[j]?.result;
    const s = typeof val === 'string' ? val : JSON.stringify(val ?? '');
    let hit = 0;
    for (const { token, o } of orphanTokens) {
      if (token.length >= 20 && s.includes(token)) {
        if (!referencedElsewhere.has(token)) referencedElsewhere.set(token, { pathname: o.pathname, keys: [] });
        referencedElsewhere.get(token).keys.push(key);
        hit++;
      }
    }
    checked++;
    if (hit > 0) console.log(`[${checked}/${targetKeys.length}] ${key} len=${s.length} 命中孤儿=${hit} ⚠️`);
  }
  console.log(`... 已检查 ${checked}/${targetKeys.length}，累计命中键=${new Set([...referencedElsewhere.values()].flatMap(v=>v.keys)).size}`);
}

// 4. 结论
console.log(`\n=== 验证结论 ===`);
console.log(`已检查键: ${checked}/${targetKeys.length} (跳过基准键 recruit:talents)`);
if (referencedElsewhere.size === 0) {
  console.log(`✅ 全部 ${orphans.length} 个孤儿均未被 recruit:talents 以外的任何键引用，删除安全。`);
  const safe = orphanTokens.filter((x) => x.token.length >= 20).map((x) => ({ url: x.o.url, pathname: x.o.pathname, size: x.o.size }));
  // 无法抽 token 的（少数）也一并保留删除，但标注
  const noToken = orphanTokens.filter((x) => x.token.length < 20);
  const all = orphans.map((o) => ({ url: o.url, pathname: o.pathname, size: o.size }));
  writeFileSync('D:/projects/recruitment-dashboard/_blob-orphans-verified.json', JSON.stringify(all, null, 2));
  console.log(`已写入 _blob-orphans-verified.json (${all.length} 个)。其中 ${noToken.length} 个无随机后缀token(按文件名匹配)。`);
} else {
  console.log(`⚠️ 发现 ${referencedElsewhere.size} 个"孤儿"实际被其他键引用，不能删！明细:`);
  for (const [token, v] of referencedElsewhere) console.log(`  ${v.pathname} <- ${v.keys.join(', ')}`);
  // 从验证清单剔除这些
  const bad = new Set([...referencedElsewhere.values()].map((v) => v.pathname));
  const safe = orphans.filter((o) => !bad.has(o.pathname)).map((o) => ({ url: o.url, pathname: o.pathname, size: o.size }));
  writeFileSync('D:/projects/recruitment-dashboard/_blob-orphans-verified.json', JSON.stringify(safe, null, 2));
  console.log(`已剔除被引用项，安全可删 ${safe.length} 个，写入 _blob-orphans-verified.json`);
}
