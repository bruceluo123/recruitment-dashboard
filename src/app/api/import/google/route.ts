import { createSign } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

// 如何配置 Google Service Account:
// 1. 打开 https://console.cloud.google.com → 选择或新建项目
// 2. "API 和服务" → "启用 API" → 搜索并启用 "Google Drive API"
// 3. "IAM 和管理" → "服务账号" → 创建服务账号（名称随意）
// 4. 点进创建好的服务账号 → "密钥" → "添加密钥" → "创建新密钥" → JSON 格式
// 5. 下载 JSON 文件，将整个内容（压缩成一行）设为 Vercel 环境变量 GOOGLE_SERVICE_ACCOUNT
// 6. 打开目标 Google Sheet → 右上角"共享" → 输入服务账号邮箱（xxx@xxx.iam.gserviceaccount.com）→ 设为"查看者"

interface ParsedGoogleUrl {
  fileId: string;
  gid?: string;
  type: 'sheet' | 'doc';
  publicExportUrl: string;
}

function parseGoogleUrl(rawUrl: string): ParsedGoogleUrl | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  if (url.hostname !== 'docs.google.com') return null;

  const sheetMatch = url.pathname.match(/\/spreadsheets\/d\/([^/]+)/);
  if (sheetMatch) {
    const gid = url.searchParams.get('gid') ?? undefined;
    return {
      fileId: sheetMatch[1],
      gid,
      type: 'sheet',
      publicExportUrl: `https://docs.google.com/spreadsheets/d/${sheetMatch[1]}/export?format=xlsx${gid ? `&gid=${gid}` : ''}`,
    };
  }

  const docMatch = url.pathname.match(/\/document\/d\/([^/]+)/);
  if (docMatch) {
    return {
      fileId: docMatch[1],
      type: 'doc',
      publicExportUrl: `https://docs.google.com/document/d/${docMatch[1]}/export?format=txt`,
    };
  }

  return null;
}

async function getServiceAccountToken(serviceAccountJson: string): Promise<string> {
  const sa = JSON.parse(serviceAccountJson) as {
    client_email: string;
    private_key: string;
  };
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const claims = Buffer.from(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/drive.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })).toString('base64url');

  const signingInput = `${header}.${claims}`;
  const sign = createSign('RSA-SHA256');
  sign.update(signingInput);
  const signature = sign.sign(sa.private_key, 'base64url');
  const jwt = `${signingInput}.${signature}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  const tokenData = await tokenRes.json() as { access_token?: string; error?: string };
  if (!tokenData.access_token) {
    throw new Error(tokenData.error ?? 'Service Account 认证失败');
  }
  return tokenData.access_token;
}

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json() as { url?: string };
    const parsed = parseGoogleUrl(String(url ?? ''));
    if (!parsed) {
      return NextResponse.json({ error: '仅支持 Google Sheets / Docs 分享链接' }, { status: 400 });
    }

    // 先尝试公开访问
    const publicRes = await fetch(parsed.publicExportUrl);
    if (publicRes.ok) {
      return buildFileResponse(await publicRes.arrayBuffer(), parsed.type);
    }

    // 公开访问失败，尝试 Service Account
    const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT;
    if (!serviceAccountJson) {
      return NextResponse.json(
        { error: '文档为私有，请在 Vercel 配置 GOOGLE_SERVICE_ACCOUNT 环境变量，并将文档共享给服务账号邮箱' },
        { status: 403 }
      );
    }

    const token = await getServiceAccountToken(serviceAccountJson);

    // Drive API 导出（支持私有文件）
    const exportMime = parsed.type === 'doc'
      ? 'text/plain'
      : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    const driveUrl = `https://www.googleapis.com/drive/v3/files/${parsed.fileId}/export?mimeType=${encodeURIComponent(exportMime)}`;

    const authRes = await fetch(driveUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!authRes.ok) {
      const body = await authRes.text();
      const isNotShared = body.includes('notFound') || body.includes('not found') || authRes.status === 404;
      return NextResponse.json(
        { error: isNotShared ? '服务账号无访问权限，请将文档共享给服务账号邮箱（查看者权限）' : `Google API 错误 ${authRes.status}` },
        { status: authRes.status }
      );
    }

    return buildFileResponse(await authRes.arrayBuffer(), parsed.type);
  } catch (err) {
    return NextResponse.json({ error: `导入失败: ${(err as Error).message}` }, { status: 500 });
  }
}

function buildFileResponse(buffer: ArrayBuffer, type: 'sheet' | 'doc'): NextResponse {
  const isDoc = type === 'doc';
  return new NextResponse(buffer, {
    headers: {
      'Content-Type': isDoc ? 'text/plain; charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="google-import.${isDoc ? 'txt' : 'xlsx'}"`,
    },
  });
}
