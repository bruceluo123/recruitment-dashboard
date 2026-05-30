// 本地验证脚本：用已登录的 SESSION 连 TG 群，抓最近消息并测试解析。
// 仅用于本地验证解析规则与群 entity 解析，不写任何数据，不上线。
//
// 用法（Git Bash，需能连 Telegram；国内挂梯子，按需带 TG_PROXY）：
//   TG_API_ID=39850827 \
//   TG_API_HASH=xxxxxxxx \
//   TG_SESSION=粘贴你的session \
//   TG_GROUP_ID=-1003993273461 \
//   TG_PROXY=socks5://127.0.0.1:7890 \
//   node scripts/tg-test.mjs
//
// 没有 TG_PROXY 就走全局/TUN 模式直连。

import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';

const apiId = parseInt(process.env.TG_API_ID || '', 10);
const apiHash = process.env.TG_API_HASH || '';
const sessionStr = (process.env.TG_SESSION || '').replace(/\s+/g, ''); // 去掉换行/空格
const groupIdRaw = process.env.TG_GROUP_ID || '-1003993273461';
const limit = parseInt(process.env.TG_LIMIT || '60', 10);

if (!apiId || !apiHash || !sessionStr) {
  console.error('缺少 TG_API_ID / TG_API_HASH / TG_SESSION 环境变量。');
  process.exit(1);
}

function parseProxy(raw) {
  if (!raw) return undefined;
  const m = raw.match(/^(?:(socks5|socks4):\/\/)?([^:]+):(\d+)$/i);
  if (!m) { console.error(`TG_PROXY 格式不对：${raw}`); process.exit(1); }
  return { ip: m[2], port: parseInt(m[3], 10), socksType: m[1]?.toLowerCase() === 'socks4' ? 4 : 5, timeout: 10 };
}

// ── 解析器（验证用，确认后会同步到 src/lib/tg-priority.ts）────────────
const PRIORITY_RE = /P\s*([0-3])/i;

function parseTgNotification(text) {
  if (!text || !text.includes('📌')) return [];
  const chunks = text.split('📌').slice(1);
  const out = [];
  for (const chunk of chunks) {
    const body = chunk.split(/📊|📝|🕐|🔍/)[0]; // 砍掉底部汇总
    const pm = body.match(PRIORITY_RE);
    if (!pm) continue;
    const priority = `P${pm[1]}`;
    // 标题：P 标记之前的部分，去掉结尾的 ｜/空白/换行
    const title = body.slice(0, pm.index).replace(/[｜|\s]+$/, '').trim();
    // P 标记之后的括号组：[0]=优先级标签（中/紧急/高），[1]=部门
    const afterP = body.slice(pm.index + pm[0].length);
    const parens = [...afterP.matchAll(/[（(]\s*([^（）()]*?)\s*[）)]/g)].map((m) => m[1].trim());
    const dept = parens[1] || undefined;
    // 状态变化：取箭头右侧的新状态
    const st = body.match(/招聘状态[：:]\s*[^→]*→\s*([^\s，,。\n]+)/);
    const status = st ? st[1].trim() : undefined;
    const gp = body.match(/缺口[：:]\s*\d+\s*→\s*(\d+)/);
    const gap = gp ? parseInt(gp[1], 10) : undefined;
    out.push({ title, priority, dept, status, gap });
  }
  return out;
}
// ────────────────────────────────────────────────────────────────────

const proxy = parseProxy(process.env.TG_PROXY);
if (proxy) console.log(`使用代理：socks${proxy.socksType}://${proxy.ip}:${proxy.port}`);

const client = new TelegramClient(new StringSession(sessionStr), apiId, apiHash, {
  connectionRetries: 3,
  ...(proxy ? { proxy } : {}),
});

await client.connect();
console.log('已连接。正在解析群 entity…');

// 尝试解析群：先列 dialogs 找匹配的 id，再 fallback 到直接 getEntity
let entity = null;
const targetId = groupIdRaw.replace(/^-100/, ''); // 超级群内部 id
try {
  const dialogs = await client.getDialogs({ limit: 200 });
  for (const d of dialogs) {
    const id = d.id?.toString() || '';
    if (id === groupIdRaw || id === targetId || id === `-${targetId}`) { entity = d.entity; break; }
    const title = d.title || d.name || '';
    if (title.includes('猎') || title.includes('招聘')) {
      console.log(`  候选群: id=${id} title=${JSON.stringify(title)}`);
    }
  }
} catch (e) {
  console.log('getDialogs 失败:', e.message);
}

if (!entity) {
  console.log(`dialogs 里没直接匹配到 ${groupIdRaw}，尝试 getEntity…`);
  try { entity = await client.getEntity(groupIdRaw); }
  catch (e) {
    console.error('getEntity 也失败:', e.message);
    console.error('请把上面打印的「候选群」里正确那条的 id 发我。');
    await client.disconnect(); process.exit(1);
  }
}

console.log('群解析成功，开始抓最近', limit, '条消息…\n');
const messages = await client.getMessages(entity, { limit });

let total = 0;
for (const msg of messages) {
  const text = msg.message || '';
  if (!text) continue;
  const entries = parseTgNotification(text);
  if (entries.length === 0) continue;
  total += entries.length;
  console.log(`── msg #${msg.id} @ ${new Date(msg.date * 1000).toISOString()} ──`);
  for (const e of entries) {
    console.log(`   [${e.priority}] ${e.title}  | 部门:${e.dept || '—'} | 状态:${e.status || '—'} | 缺口:${e.gap ?? '—'}`);
  }
}
console.log(`\n共解析出 ${total} 条岗位条目（来自最近 ${limit} 条消息）。`);
await client.disconnect();
process.exit(0);
