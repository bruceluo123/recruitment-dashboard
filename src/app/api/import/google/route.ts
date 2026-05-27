import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json();
    const exportUrl = getGoogleExportUrl(String(url || ''));
    if (!exportUrl) {
      return NextResponse.json({ error: '仅支持 Google Sheets / Docs 分享链接' }, { status: 400 });
    }

    const res = await fetch(exportUrl);
    if (!res.ok) {
      return NextResponse.json({ error: '无法读取 Google 文档，请确认链接已开放查看权限' }, { status: res.status });
    }

    const contentType = exportUrl.includes('/document/') ? 'text/plain; charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    return new NextResponse(await res.arrayBuffer(), {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="google-import.${contentType.startsWith('text/') ? 'txt' : 'xlsx'}"`,
      },
    });
  } catch (err) {
    return NextResponse.json({ error: `导入失败: ${(err as Error).message}` }, { status: 500 });
  }
}

function getGoogleExportUrl(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  if (url.hostname !== 'docs.google.com') return null;

  const sheetMatch = url.pathname.match(/\/spreadsheets\/d\/([^/]+)/);
  if (sheetMatch) {
    const gid = url.searchParams.get('gid');
    return `https://docs.google.com/spreadsheets/d/${sheetMatch[1]}/export?format=xlsx${gid ? `&gid=${gid}` : ''}`;
  }

  const docMatch = url.pathname.match(/\/document\/d\/([^/]+)/);
  if (docMatch) {
    return `https://docs.google.com/document/d/${docMatch[1]}/export?format=txt`;
  }

  return null;
}
