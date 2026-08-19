import { NextRequest, NextResponse } from 'next/server';
import { blobUrlError, guardApi } from '@/lib/api-guard';
import { kvGet, kvRPush, kvSet } from '@/lib/kv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const recordKey = (id: string) => `recruit:tg-delivery:${id}`;

function accountKeys(sender: 'a' | 'b') {
  return sender === 'b'
    ? { queue: 'recruit:tg-delivery-pending-b', heartbeat: 'recruit:tg-delivery-worker-heartbeat-b' }
    : { queue: 'recruit:tg-delivery-pending', heartbeat: 'recruit:tg-delivery-worker-heartbeat' };
}

interface DeliveryRecord {
  id: string;
  status: 'queued' | 'sending' | 'sent' | 'failed';
  createdAt: string;
  target: string;
  fileUrl: string;
  deliveries: Array<{ text: string; fileName: string }>;
  sender?: 'a' | 'b';
  sent?: number;
  error?: string;
  finishedAt?: string;
}

interface WorkerHeartbeat {
  at: string;
}

function parseRecord(value: DeliveryRecord | string | null): DeliveryRecord | null {
  if (!value) return null;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value) as DeliveryRecord; } catch { return null; }
}

function parseHeartbeat(value: WorkerHeartbeat | string | null): WorkerHeartbeat | null {
  if (!value) return null;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value) as WorkerHeartbeat; } catch { return null; }
}

function safeFileName(value: string): string {
  return value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180) || 'resume.pdf';
}

export async function POST(request: NextRequest) {
  const blocked = guardApi(request, 'tg-send-recommendation', 12, 60_000);
  if (blocked) return blocked;

  let body: {
    requestId?: string;
    target?: string;
    text?: string;
    fileUrl?: string;
    fileName?: string;
    deliveries?: Array<{ text?: string; fileName?: string }>;
    sender?: 'a' | 'b';
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: '请求格式错误' }, { status: 400 });
  }

  const target = body.target?.trim() || '';
  const sender: 'a' | 'b' = body.sender === 'b' ? 'b' : 'a';
  const keys = accountKeys(sender);
  const fileUrl = body.fileUrl?.trim() || '';
  const requestId = body.requestId?.trim() || '';
  if (requestId && !/^[A-Za-z0-9-]{8,80}$/.test(requestId)) {
    return NextResponse.json({ ok: false, error: '发送请求编号无效' }, { status: 400 });
  }
  const deliveries = (body.deliveries?.length
    ? body.deliveries
    : [{ text: body.text, fileName: body.fileName }])
    .slice(0, 10)
    .map((item) => ({
      text: item.text?.trim() || '',
      fileName: safeFileName(item.fileName || 'resume.pdf'),
    }))
    .filter((item) => item.text);
  if (!target || !fileUrl || deliveries.length === 0) {
    return NextResponse.json({ ok: false, error: '接收人、推荐文案和简历均不能为空' }, { status: 400 });
  }
  const urlError = blobUrlError(fileUrl);
  if (urlError) return NextResponse.json({ ok: false, error: urlError }, { status: 400 });

  const id = requestId || `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const existing = parseRecord(await kvGet<DeliveryRecord | string>(recordKey(id)));
  if (existing) {
    if (existing.status === 'failed') {
      return NextResponse.json({ ok: false, error: existing.error || 'TG 发送失败' }, { status: 502 });
    }
    return NextResponse.json({
      ok: true,
      queued: existing.status === 'queued' || existing.status === 'sending',
      id,
      sent: existing.sent || 0,
    });
  }

  const heartbeat = parseHeartbeat(await kvGet<WorkerHeartbeat | string>(keys.heartbeat));
  const heartbeatAt = heartbeat?.at ? new Date(heartbeat.at).getTime() : 0;
  if (!heartbeatAt || Date.now() - heartbeatAt > 45_000) {
    return NextResponse.json(
      { ok: false, error: 'TG 发送器当前离线，请确认工作站代理已连接后重试' },
      { status: 503 },
    );
  }

  const record: DeliveryRecord = {
    id,
    status: 'queued',
    createdAt: new Date().toISOString(),
    target,
    fileUrl,
    deliveries,
    sender,
  };
  const saved = await kvSet(recordKey(id), record);
  const queued = saved && await kvRPush(keys.queue, id);
  if (!queued) {
    return NextResponse.json({ ok: false, error: '发送队列暂不可用，请稍后重试' }, { status: 503 });
  }
  return NextResponse.json({ ok: true, queued: true, id, sent: 0 });
}

export async function GET(request: NextRequest) {
  const blocked = guardApi(request, 'tg-send-status', 60, 60_000);
  if (blocked) return blocked;
  const id = request.nextUrl.searchParams.get('id')?.trim() || '';
  if (!id || !/^[A-Za-z0-9-]+$/.test(id)) {
    return NextResponse.json({ ok: false, error: '发送编号无效' }, { status: 400 });
  }
  const record = parseRecord(await kvGet<DeliveryRecord | string>(recordKey(id)));
  if (!record) return NextResponse.json({ ok: false, error: '未找到发送记录' }, { status: 404 });
  return NextResponse.json({
    ok: true,
    status: record.status,
    sent: record.sent || 0,
    error: record.error || '',
    finishedAt: record.finishedAt || '',
  });
}
