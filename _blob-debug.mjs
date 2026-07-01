import { readFileSync } from 'node:fs';
import { list } from '@vercel/blob';

const env = readFileSync('D:/projects/recruitment-dashboard/.env.local', 'utf8');
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim().replace(/^["']|["']$/g, '');
const TOKEN = get('BLOB_READ_WRITE_TOKEN');
const KV_URL = get('KV_REST_API_URL') || 'https://positive-mongrel-70521.upstash.io';
const KV_TOKEN = get('KV_REST_API_TOKEN');

// 拉人才库
const r = await fetch(`${KV_URL}/get/recruit:talents`, { headers: { Authorization: `Bearer ${KV_TOKEN}` } });
const j = await r.json();
let talents = j.result;
if (typeof talents === 'string') talents = JSON.parse(talents);

const withUrl = talents.filter((t) => t.resumeUrl);
console.log('=== 人才库 resumeUrl 样例(前8) ===');
withUrl.slice(0, 8).forEach((t) => console.log(`  [${t.name}] ${t.resumeUrl}`));

console.log('\n=== resumeUrl 域名分布 ===');
const hosts = {};
for (const t of withUrl) { try { const h = new URL(t.resumeUrl).host; hosts[h] = (hosts[h]||0)+1; } catch { hosts['(非法URL)'] = (hosts['(非法URL)']||0)+1; } }
console.log(hosts);

// 列 blob 前几个 pathname + host
let page = await list({ token: TOKEN, limit: 5 });
console.log('\n=== blob 样例 url ===');
page.blobs.forEach((b) => console.log(`  ${b.url}`));
console.log('\n=== blob host ===', page.blobs[0] ? new URL(page.blobs[0].url).host : '?');
