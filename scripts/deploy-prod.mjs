#!/usr/bin/env node
// 通过「本地代理 + Vercel REST API」把 master 最新提交部署到生产环境。
//
// 为什么需要它：
//   1) 本项目的 Vercel↔GitHub 自动部署链接已断开（GitHub App 授权丢失），
//      所以 push 到 master 不会自动触发部署。
//   2) 这台机器的 `vercel` CLI 自带 undici，启动时要访问 vercel.com 做 OIDC 发现，
//      而该请求无视所有代理环境变量、又被网络阻断，于是 CLI 必然失败。
//
// 本脚本绕开以上两点：自动探测可用的本地 HTTP 代理 → 用 CLI 已存的 OAuth
// 刷新令牌换取新 access token（经代理）→ 直接调 /v13/deployments 从 GitHub
// master 建生产部署 → 轮询直到 READY → 校验生产域名。
//
// 用法： node scripts/deploy-prod.mjs
//   - 凭据从 Vercel CLI 的 auth.json 读取（不写进仓库）。
//   - projectId/orgId 从 .vercel/project.json 读取（已 gitignore）。
//   - 仅依赖项目里已有的 undici。

import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ProxyAgent } from 'undici';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Vercel CLI 的公开 OAuth client_id（开源常量，非密钥）
const VERCEL_CLI_CLIENT_ID = 'cl_HYyOPBNtFMfHhaUn9L4QPfTZz6TP47bp';
const TOKEN_ENDPOINT = 'https://api.vercel.com/login/oauth/token';
const API = 'https://api.vercel.com';
const REPO = 'bruceluo123/recruitment-dashboard';
const REPO_ID = 1238411466;
const REF = 'master';
const PROD_URL = 'https://qieqiuzhidao.vercel.app';

const AUTH_PATH = path.join(
  process.env.APPDATA || '',
  'xdg.data',
  'com.vercel.cli',
  'auth.json',
);
const PROJECT_LINK = path.join(ROOT, '.vercel', 'project.json');

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// —— 探测一个可用的本地 HTTP 代理（端口随代理软件重启会变）——
function listLocalListeningPorts() {
  const out = execSync('netstat -ano -p tcp', { encoding: 'utf8' });
  const ports = new Set();
  for (const line of out.split('\n')) {
    if (!line.includes('LISTENING')) continue;
    const m = line.match(/127\.0\.0\.1:(\d+)\s/);
    if (m) ports.add(Number(m[1]));
  }
  return [...ports];
}

function testProxy(port, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const sock = net.connect(port, '127.0.0.1');
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(timeoutMs, () => finish(false));
    sock.on('error', () => finish(false));
    sock.on('close', () => finish(false));
    sock.on('end', () => finish(false));
    sock.on('connect', () => {
      sock.write(
        'CONNECT api.vercel.com:443 HTTP/1.1\r\nHost: api.vercel.com:443\r\n\r\n',
      );
    });
    sock.on('data', (buf) => {
      const head = buf.toString('latin1', 0, 64);
      finish(/^HTTP\/1\.[01] 200/.test(head));
    });
  });
}

async function findProxy() {
  const ports = listLocalListeningPorts();
  // 并发探测，返回第一个能 CONNECT 通外网的端口
  const results = await Promise.all(
    ports.map(async (p) => ({ p, ok: await testProxy(p) })),
  );
  const hit = results.find((r) => r.ok);
  if (!hit) {
    throw new Error(
      '没找到可用的本地 HTTP 代理。请确认代理软件在运行，或手动设置 DEPLOY_PROXY=http://127.0.0.1:端口',
    );
  }
  return `http://127.0.0.1:${hit.p}`;
}

async function refreshTokenIfNeeded(dispatcher) {
  const auth = readJson(AUTH_PATH);
  const now = Math.floor(Date.now() / 1000);
  if (auth.expiresAt && now < auth.expiresAt - 120) {
    return auth.token; // 仍有效
  }
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: auth.refreshToken,
    client_id: VERCEL_CLI_CLIENT_ID,
  });
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    dispatcher,
  });
  if (!res.ok) {
    throw new Error(`刷新 token 失败 HTTP ${res.status}: ${await res.text()}`);
  }
  const t = await res.json();
  // 刷新令牌会轮换，写回 auth.json 保持 CLI 凭据一致
  const next = {
    ...auth,
    token: t.access_token,
    refreshToken: t.refresh_token || auth.refreshToken,
    expiresAt: now + (t.expires_in || 28800),
  };
  fs.writeFileSync(AUTH_PATH, JSON.stringify(next, null, 2));
  return t.access_token;
}

async function api(pathname, token, teamId, dispatcher, init = {}) {
  const sep = pathname.includes('?') ? '&' : '?';
  const url = `${API}${pathname}${sep}teamId=${teamId}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
    dispatcher,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`API ${pathname} HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return json;
}

async function main() {
  const proxyUrl = process.env.DEPLOY_PROXY || (await findProxy());
  console.log(`✓ 使用代理 ${proxyUrl}`);
  const dispatcher = new ProxyAgent(proxyUrl);

  const link = readJson(PROJECT_LINK);
  const { projectId, orgId } = link;

  const token = await refreshTokenIfNeeded(dispatcher);
  console.log('✓ 已获取有效 access token');

  console.log(`→ 从 GitHub ${REPO}@${REF} 创建生产部署…`);
  const dep = await api(
    '/v13/deployments?forceNew=1',
    token,
    orgId,
    dispatcher,
    {
      method: 'POST',
      body: JSON.stringify({
        name: link.projectName || 'recruitment-dashboard',
        project: projectId,
        target: 'production',
        gitSource: { type: 'github', ref: REF, repoId: REPO_ID },
      }),
    },
  );
  const depId = dep.id;
  const sha = (dep.meta && dep.meta.githubCommitSha) || '';
  console.log(`✓ 部署已创建 ${depId} (commit ${sha.slice(0, 8)})`);

  process.stdout.write('  构建中');
  let state = dep.readyState || 'INITIALIZING';
  for (let i = 0; i < 40 && !/READY|ERROR|CANCELED/.test(state); i++) {
    await new Promise((r) => setTimeout(r, 12000));
    const s = await api(`/v13/deployments/${depId}`, token, orgId, dispatcher);
    state = s.readyState;
    process.stdout.write('.');
  }
  console.log(`\n部署状态: ${state}`);
  if (state !== 'READY') {
    throw new Error(`部署未成功（状态 ${state}），请去 Vercel 后台看构建日志`);
  }

  // 校验生产域名（命令行到 *.vercel.app 可能不稳，校验失败不代表部署失败）
  const check = await fetch(`${PROD_URL}/`, { dispatcher })
    .then((r) => r.status)
    .catch(() => 0);
  const note = check === 200 ? '已生效' : '（命令行校验受限，以浏览器为准）';
  console.log(`✓ 部署 READY 并已切到生产域名：${PROD_URL} ${note}`);
  console.log('完成。如仍看到旧页面，浏览器按 Ctrl+Shift+R 硬刷新。');
}

main().catch((e) => {
  console.error('部署失败：', e.message);
  process.exit(1);
});
