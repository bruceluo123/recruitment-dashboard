import { readFileSync, writeFileSync } from 'node:fs';
import { del } from '@vercel/blob';

const env = readFileSync('D:/projects/recruitment-dashboard/.env.local', 'utf8');
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim().replace(/^["']|["']$/g, '');
const TOKEN = get('BLOB_READ_WRITE_TOKEN');
if (!TOKEN) { console.error('无 BLOB_READ_WRITE_TOKEN'); process.exit(1); }

const safe = JSON.parse(readFileSync('D:/projects/recruitment-dashboard/_blob-orphans-verified.json', 'utf8'));
const totalBytes = safe.reduce((s, o) => s + (o.size || 0), 0);
const MB = (n) => (n / 1024 / 1024).toFixed(1);
console.log(`待删安全孤儿: ${safe.length} 个, 共 ${MB(totalBytes)} MB`);

// 分批删除（每批 20，del 接受 url 数组），带重试
const urls = safe.map((o) => o.url);
const BATCH = 20;
let done = 0;
const failed = [];
for (let i = 0; i < urls.length; i += BATCH) {
  const batch = urls.slice(i, i + BATCH);
  let ok = false;
  for (let t = 0; t < 4 && !ok; t++) {
    try {
      await del(batch, { token: TOKEN });
      ok = true;
    } catch (e) {
      if (t === 3) { failed.push(...batch); console.log(`!! 批次 ${i} 删除失败: ${e.message}`); }
      else await new Promise((r) => setTimeout(r, 1500 * (t + 1)));
    }
  }
  if (ok) done += batch.length;
  console.log(`已删 ${done}/${urls.length}`);
}
console.log(`\n=== 删除完成 ===`);
console.log(`成功: ${done}, 失败: ${failed.length}, 释放约 ${MB(totalBytes)} MB`);
if (failed.length) writeFileSync('D:/projects/recruitment-dashboard/_blob-delete-failed.json', JSON.stringify(failed, null, 2));
