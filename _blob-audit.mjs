import { readFileSync } from 'node:fs';
import { list } from '@vercel/blob';

// 读 .env.local 取 token
const env = readFileSync('D:/projects/recruitment-dashboard/.env.local', 'utf8');
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim().replace(/^["']|["']$/g, '');
const TOKEN = get('BLOB_READ_WRITE_TOKEN');
const KV_URL = get('RECRUIT_KV_URL') || get('KV_REST_API_URL') || 'https://positive-mongrel-70521.upstash.io';
const KV_TOKEN = get('RECRUIT_KV_TOKEN') || get('KV_REST_API_TOKEN');

if (!TOKEN) { console.error('无 BLOB_READ_WRITE_TOKEN'); process.exit(1); }

// 1. 列出所有 blob（分页）
let blobs = [];
let cursor;
do {
  const page = await list({ token: TOKEN, cursor, limit: 1000 });
  blobs = blobs.concat(page.blobs);
  cursor = page.cursor;
} while (cursor);

const totalBytes = blobs.reduce((s, b) => s + (b.size || 0), 0);
const MB = (n) => (n / 1024 / 1024).toFixed(1);
console.log(`=== Blob 总览 ===`);
console.log(`文件数: ${blobs.length}, 总大小: ${MB(totalBytes)} MB`);

// 按前缀分组
const byPrefix = {};
for (const b of blobs) {
  const pre = b.pathname.split('/')[0] || '(root)';
  byPrefix[pre] = byPrefix[pre] || { n: 0, bytes: 0 };
  byPrefix[pre].n++; byPrefix[pre].bytes += b.size || 0;
}
console.log('\n=== 按前缀 ===');
for (const [k, v] of Object.entries(byPrefix).sort((a,b)=>b[1].bytes-a[1].bytes))
  console.log(`  ${k}: ${v.n} 个, ${MB(v.bytes)} MB`);

// 2. 拉人才库，收集被引用的 resumeUrl
let referenced = new Set();
if (KV_TOKEN) {
  try {
    const r = await fetch(`${KV_URL}/get/recruit:talents`, { headers: { Authorization: `Bearer ${KV_TOKEN}` } });
    const j = await r.json();
    let talents = j.result;
    if (typeof talents === 'string') talents = JSON.parse(talents);
    if (Array.isArray(talents)) {
      for (const t of talents) {
        for (const u of [t.resumeUrl, t.resume_url]) {
          if (u && typeof u === 'string') {
            // 存 pathname 部分用于匹配
            try { referenced.add(decodeURIComponent(new URL(u).pathname.replace(/^\//, ''))); } catch {}
          }
        }
      }
    }
    console.log(`\n人才库记录数: ${Array.isArray(talents) ? talents.length : '?'}, 引用简历URL数: ${referenced.size}`);
  } catch (e) { console.log('拉人才库失败:', e.message); }
} else {
  console.log('\n无 KV token，跳过引用比对');
}

// 3. 判定孤儿：blob 的 pathname 不在 referenced 中
// 注意 addRandomSuffix 会改文件名，匹配用 blob.url 的 pathname 直接对
const orphans = blobs.filter((b) => !referenced.has(b.pathname));
const orphanBytes = orphans.reduce((s, b) => s + (b.size || 0), 0);
console.log(`\n=== 孤儿文件(未被人才库引用) ===`);
console.log(`数量: ${orphans.length}, 占用: ${MB(orphanBytes)} MB (占总量 ${(orphanBytes/totalBytes*100).toFixed(0)}%)`);
console.log('\n样例(前10):');
orphans.slice(0, 10).forEach((b) => console.log(`  ${b.pathname} | ${MB(b.size)}MB | ${b.uploadedAt}`));

// 写出孤儿清单供删除
import { writeFileSync } from 'node:fs';
writeFileSync('D:/projects/recruitment-dashboard/_blob-orphans.json',
  JSON.stringify(orphans.map((b) => ({ url: b.url, pathname: b.pathname, size: b.size })), null, 2));
console.log(`\n孤儿清单已写入 _blob-orphans.json`);
