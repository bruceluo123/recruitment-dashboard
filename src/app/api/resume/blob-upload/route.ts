import { NextRequest, NextResponse } from 'next/server';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';

export const runtime = 'nodejs';

// 客户端直传 Vercel Blob 的令牌路由：浏览器经 @vercel/blob/client 的 upload() 调用此处换取上传令牌，
// 文件随后由浏览器直接传到 Blob，绕过 Vercel Serverless 4.5MB 请求体上限（大简历/作品集 PDF 必经此路径）。
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: '云端文件存储未配置（缺少 BLOB_READ_WRITE_TOKEN），请在 Vercel 项目中关联 Blob Store' },
      { status: 500 },
    );
  }

  const body = (await request.json()) as HandleUploadBody;
  try {
    const result = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: [
          'application/pdf',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/octet-stream',
        ],
        addRandomSuffix: true,
        // 上限放宽到 50MB，覆盖作品集型简历；实际由 Gemini OCR 内联上限（~20MB）兜底
        maximumSizeInBytes: 50 * 1024 * 1024,
      }),
      // 直传完成回调：此处无需落库，解析在 /api/resume/parse 拉取 Blob URL 时进行
      onUploadCompleted: async () => {},
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
