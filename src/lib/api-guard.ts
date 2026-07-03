// API 路由安全护栏 — 集中实现同源校验、Blob URL 白名单（防 SSRF）、轻量限流。
// 设计原则：全部非破坏性。同源校验放行「浏览器同域请求」与本地开发；
// 限流为进程内滑动窗口（同一 serverless 实例内生效，作为第一层防刷，成本为零）。
import { NextRequest, NextResponse } from 'next/server';

/** 允许被服务端 fetch 的 Blob 主机后缀（防 SSRF：只拉取自己的 Vercel Blob 简历）。 */
const ALLOWED_BLOB_HOST_SUFFIX = '.blob.vercel-storage.com';

/** 校验 URL 是否指向本项目 Vercel Blob。非法则返回错误原因，合法返回 null。 */
export function blobUrlError(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'URL 格式非法';
  }
  if (parsed.protocol !== 'https:') return '仅允许 https 链接';
  if (!parsed.hostname.endsWith(ALLOWED_BLOB_HOST_SUFFIX)) {
    return '仅允许拉取 Vercel Blob 存储的文件';
  }
  return null;
}

/**
 * 同源校验：放行 Origin 或 Referer 的主机名与请求自身 host 相同的请求，
 * 以及本地开发（localhost/127.0.0.1）。用于挡住外部脚本盗用 AI 代理端点刷账单。
 * 无法完全防伪造，但显著抬高滥用成本，且不破坏浏览器同域调用。
 */
export function isSameOrigin(req: NextRequest): boolean {
  const host = req.headers.get('host') || '';
  if (!host) return false;
  if (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return true;

  const candidates = [req.headers.get('origin'), req.headers.get('referer')];
  for (const raw of candidates) {
    if (!raw) continue;
    try {
      if (new URL(raw).host === host) return true;
    } catch {
      // 忽略非法头
    }
  }
  return false;
}

/** 同源校验失败时的标准 403 响应（同源则返回 null 放行）。 */
export function sameOriginGuard(req: NextRequest): NextResponse | null {
  if (isSameOrigin(req)) return null;
  return NextResponse.json({ error: '禁止跨域调用' }, { status: 403 });
}

// ── 进程内滑动窗口限流 ───────────────────────────────────────────
const hits = new Map<string, number[]>();

/** 返回 true 表示放行；false 表示超限。key 建议用 `ip:route`。 */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) {
    hits.set(key, arr);
    return false;
  }
  arr.push(now);
  hits.set(key, arr);
  return true;
}

/** 从常见代理头提取客户端 IP（Vercel 用 x-forwarded-for）。 */
export function clientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('x-real-ip') || 'unknown';
}

/**
 * 组合护栏：同源 + 按 IP 限流。任一不过则返回响应，全过返回 null。
 * limit/windowMs 默认每分钟 20 次，适合 AI 代理这类付费端点。
 */
export function guardApi(
  req: NextRequest,
  route: string,
  limit = 20,
  windowMs = 60_000,
): NextResponse | null {
  const originFail = sameOriginGuard(req);
  if (originFail) return originFail;
  if (!rateLimit(`${clientIp(req)}:${route}`, limit, windowMs)) {
    return NextResponse.json({ error: '请求过于频繁，请稍后再试' }, { status: 429 });
  }
  return null;
}
