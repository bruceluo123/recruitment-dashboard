// 一次性 Telegram 用户账号登录脚本，生成 SESSION 字符串。
// 用法（本地，需能连通 Telegram，国内请挂梯子）：
//   1. 去 https://my.telegram.org 申请 API_ID / API_HASH
//   2. 设置环境变量后运行：
//        TG_API_ID=xxxxx TG_API_HASH=xxxxxxxx node scripts/tg-login.mjs
//      （Windows bash 同样支持上面的写法）
//   3. 按提示输入手机号（带国家码，如 +8613800138000）、收到的验证码、
//      若开了两步验证再输入密码
//   4. 脚本会打印一长串 SESSION，把它配置到 Vercel 环境变量 TG_SESSION
//
// 注意：验证码/密码只在你本地输入，不会上传到任何地方。生成的 SESSION
// 等同于登录态，请妥善保管、勿外泄。

import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import input from 'input';
import fs from 'node:fs';
import path from 'node:path';

const apiId = parseInt(process.env.TG_API_ID || '', 10);
const apiHash = process.env.TG_API_HASH || '';

function saveSessionToEnv(key, value) {
  if (!/^TG_[A-Z0-9_]*SESSION$/.test(key)) throw new Error('TG_SAVE_ENV_KEY 无效');
  const envPath = path.join(process.cwd(), '.env.local');
  const raw = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const nextLine = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  const next = pattern.test(raw)
    ? raw.replace(pattern, nextLine)
    : `${raw.trimEnd()}${raw.trim() ? '\n' : ''}${nextLine}\n`;
  fs.writeFileSync(envPath, next, 'utf8');
}

if (!apiId || !apiHash) {
  console.error('缺少 TG_API_ID / TG_API_HASH 环境变量。');
  console.error('示例：TG_API_ID=123456 TG_API_HASH=abcdef node scripts/tg-login.mjs');
  process.exit(1);
}

// 可选代理：国内本地登录时通过 SOCKS5 代理连 Telegram。
// 设置 TG_PROXY，如 "socks5://127.0.0.1:7890" 或 "127.0.0.1:7890"（默认 socks5）。
function parseProxy(raw) {
  if (!raw) return undefined;
  const m = raw.match(/^(?:(socks5|socks4):\/\/)?([^:]+):(\d+)$/i);
  if (!m) {
    console.error(`TG_PROXY 格式不对：${raw}（应为 host:port 或 socks5://host:port）`);
    process.exit(1);
  }
  return {
    ip: m[2],
    port: parseInt(m[3], 10),
    socksType: m[1]?.toLowerCase() === 'socks4' ? 4 : 5,
    timeout: 10,
  };
}

const proxy = parseProxy(process.env.TG_PROXY);
if (proxy) console.log(`使用代理：socks${proxy.socksType}://${proxy.ip}:${proxy.port}`);

const session = new StringSession(''); // 空白起步，登录后导出

const client = new TelegramClient(session, apiId, apiHash, {
  connectionRetries: 5,
  ...(proxy ? { proxy } : {}),
});

await client.start({
  phoneNumber: async () => process.env.TG_PHONE || await input.text('手机号（带国家码，如 +86138...）: '),
  password: async () => await input.text('两步验证密码（没开就直接回车）: '),
  phoneCode: async () => await input.text('收到的验证码: '),
  onError: (err) => console.error(err),
});

const savedSession = client.session.save();
if (process.env.TG_SAVE_ENV_KEY) {
  saveSessionToEnv(process.env.TG_SAVE_ENV_KEY, savedSession);
  console.log(`\n登录成功，会话已安全写入 ${process.env.TG_SAVE_ENV_KEY}。`);
} else {
  console.log('\n登录成功！下面是你的 SESSION（配置到 Vercel 环境变量 TG_SESSION）：\n');
  console.log(savedSession);
  console.log('\n请妥善保管，勿外泄。');
}
await client.disconnect();
process.exit(0);
