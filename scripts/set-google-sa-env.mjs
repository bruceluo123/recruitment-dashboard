// 一次性脚本：把 Google Service Account JSON 设为 Vercel 环境变量
// 用法: node scripts/set-google-sa-env.mjs <json文件路径>
// 例如: node scripts/set-google-sa-env.mjs "C:/Users/Administrator/Desktop/my-project-99925-497603-969be8ba4ad7.json"
import { readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { resolve } from 'path';

const jsonPath = process.argv[2];
if (!jsonPath || !existsSync(jsonPath)) {
  console.error('请提供 JSON 文件路径');
  process.exit(1);
}

const raw = readFileSync(resolve(jsonPath), 'utf-8');
// 验证是合法 JSON 且是 service_account 类型
const parsed = JSON.parse(raw);
if (parsed.type !== 'service_account') {
  console.error('不是 service_account 类型的 JSON');
  process.exit(1);
}

const minified = JSON.stringify(parsed);
console.log(`Service Account: ${parsed.client_email}`);
console.log('正在设置 Vercel 环境变量...');

// 写入临时文件避免命令行转义问题
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const tmpFile = join(tmpdir(), 'sa_env_value.txt');
writeFileSync(tmpFile, minified, 'utf-8');

try {
  execSync(`npx vercel env add GOOGLE_SERVICE_ACCOUNT production --value "${minified.replace(/"/g, '\\"')}" --yes`, {
    stdio: 'inherit',
    windowsHide: true,
  });
} catch {
  // fallback: use --stdin approach
  try {
    execSync('npx vercel env add GOOGLE_SERVICE_ACCOUNT production --yes', {
      input: minified,
      stdio: ['pipe', 'inherit', 'inherit'],
    });
  } catch (err) {
    console.error('设置失败:', err.message);
    process.exit(1);
  }
} finally {
  try { unlinkSync(tmpFile); } catch {}
}

console.log('✓ GOOGLE_SERVICE_ACCOUNT 已设置');
