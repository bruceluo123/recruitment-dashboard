import { NextRequest, NextResponse } from 'next/server';
import { del } from '@vercel/blob';
import { blobUrlError, guardApi } from '@/lib/api-guard';
import { requireApiSession, requireOwnerSession } from '@/lib/auth-api';
import { kvGet } from '@/lib/kv';
import { kvCommandStrict, kvFindRepushRecords, kvTransaction } from '@/lib/kv-server';
import { resumeFileMatchesCandidate } from '@/lib/resume-identity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const recordKey = (id: string) => `recruit:tg-delivery:${id}`;
const DELIVERY_TTL_SECONDS = 7 * 24 * 60 * 60;

function accountKeys(sender: 'a' | 'b') {
  return sender === 'b'
    ? { queue: 'recruit:tg-delivery-pending-b', heartbeat: 'recruit:tg-delivery-worker-heartbeat-b' }
    : { queue: 'recruit:tg-delivery-pending', heartbeat: 'recruit:tg-delivery-worker-heartbeat' };
}

async function enqueueDelivery(
  record: DeliveryRecord,
  additions: BusinessRecommendation[],
  sender: 'a' | 'b',
): Promise<number> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const repushRaw = await kvCommandStrict<string | null>('GET', 'recruit:repush');
    let repush: BusinessRecommendation[];
    try { repush = parseBusinessRecommendations(repushRaw); }
    catch { return -1; }
    const ids = new Set(repush.flatMap((item) => [item.id, item.applicationId].filter(Boolean) as string[]));
    if (additions.some((item) => !item.id || ids.has(item.id))) return -2;
    const committed = await kvTransaction({
      expected: [
        { key: recordKey(record.id), exists: false },
        { key: 'recruit:repush', exists: Boolean(repushRaw), ...(repushRaw ? { value: repushRaw } : {}) },
      ],
      writes: [
        { key: recordKey(record.id), value: JSON.stringify(record), ttlSeconds: DELIVERY_TTL_SECONDS },
        { key: 'recruit:repush', value: JSON.stringify([...repush, ...additions]) },
      ],
      lists: [{ op: 'push', key: accountKeys(sender).queue, value: record.id }],
      increments: ['recruit:version'],
    });
    if (committed.ok) return 1;
    if (await kvCommandStrict<number>('EXISTS', recordKey(record.id))) return 0;
  }
  return 0;
}

async function requeueDelivery(record: DeliveryRecord, expectedRaw: string, sender: 'a' | 'b'): Promise<boolean> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const repushRaw = await kvCommandStrict<string | null>('GET', 'recruit:repush');
    let repush: BusinessRecommendation[];
    try { repush = parseBusinessRecommendations(repushRaw); }
    catch { return false; }
    let changed = false;
    const nextRepush = repush.map((item) => {
      if (item.deliveryId !== record.id) return item;
      const delivery = record.deliveries[Number(item.deliveryIndex) || 0];
      if (!delivery || delivery.status === 'sent') return item;
      changed = true;
      return {
        ...item,
        deliveryStatus: 'queued' as const,
        telegramMessageId: undefined,
        deliveredAt: undefined,
        deliveryUpdatedAt: record.updatedAt,
      };
    });
    const committed = await kvTransaction({
      expected: [
        { key: recordKey(record.id), exists: true, value: expectedRaw },
        { key: 'recruit:repush', exists: Boolean(repushRaw), ...(repushRaw ? { value: repushRaw } : {}) },
      ],
      writes: [
        { key: recordKey(record.id), value: JSON.stringify(record), ttlSeconds: DELIVERY_TTL_SECONDS },
        ...(changed ? [{ key: 'recruit:repush', value: JSON.stringify(nextRepush) }] : []),
      ],
      lists: [{ op: 'push', key: accountKeys(sender).queue, value: record.id }],
      increments: changed ? ['recruit:version'] : [],
    });
    if (committed.ok) return true;
    const latest = await kvCommandStrict<string | null>('GET', recordKey(record.id));
    if (latest !== expectedRaw) return false;
  }
  return false;
}

type DeliveryStatus = 'pending' | 'sending' | 'sent' | 'failed';

interface DeliveryItem {
  text: string;
  fileName: string;
  status?: DeliveryStatus;
  attempts?: number;
  messageId?: string;
  error?: string;
  sentAt?: string;
}

interface DeliveryApplicationInput {
  jdId?: string;
  candidateCode?: string;
  candidateIdentityId?: string;
  candidateName?: string;
  jdTitle?: string;
  contact?: string;
  contactPerson?: string;
  organization?: string;
  department?: string;
  highlights?: string;
  resumeFileName?: string;
  source?: 'intake' | 'repush';
  repushSourceId?: string;
}

interface RepushSourceRecord extends BusinessRecommendation {
  candidateCode?: string;
  candidateIdentityId?: string;
  candidateName?: string;
  resumeUrl?: string;
  resumeFileName?: string;
  fileName?: string;
}

interface DeliveryApplication {
  index: number;
  applicationId: string;
  jdId: string;
}

interface DeliveryRecord {
  id: string;
  status: 'queued' | 'sending' | 'sent' | 'failed' | 'partial_failed';
  createdAt: string;
  target: string;
  fileUrl: string;
  deliveries: DeliveryItem[];
  applications?: DeliveryApplication[];
  sender?: 'a' | 'b';
  sent?: number;
  error?: string;
  updatedAt?: string;
  queuedAt?: string;
  retryCount?: number;
  finishedAt?: string;
  cleanedAt?: string;
  lease?: {
    workerId: string;
    claimedAt: string;
    expiresAt: string;
  };
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

function normalizedDeliveries(record: DeliveryRecord): DeliveryItem[] {
  const legacySent = Math.max(0, Number(record.sent) || 0);
  return (record.deliveries || []).map((delivery, index) => {
    const recordedSuccess = delivery.status === 'sent' || delivery.messageId != null || index < legacySent;
    return {
      ...delivery,
      status: recordedSuccess ? 'sent' : delivery.status || 'pending',
    };
  });
}

function sentCount(deliveries: DeliveryItem[]): number {
  return deliveries.filter((delivery) => delivery.status === 'sent').length;
}

function publicStatus(record: DeliveryRecord, deliveries: DeliveryItem[]): DeliveryRecord['status'] {
  const sent = sentCount(deliveries);
  if (sent === deliveries.length && deliveries.length > 0) return 'sent';
  if (record.status === 'sent' || record.status === 'failed' || record.status === 'partial_failed') {
    return sent > 0 ? 'partial_failed' : 'failed';
  }
  return record.status;
}

async function workerIsOnline(sender: 'a' | 'b'): Promise<boolean> {
  const heartbeat = parseHeartbeat(await kvGet<WorkerHeartbeat | string>(accountKeys(sender).heartbeat));
  const heartbeatAt = heartbeat?.at ? new Date(heartbeat.at).getTime() : 0;
  return Boolean(heartbeatAt && Date.now() - heartbeatAt <= 45_000);
}

function deliveryResults(deliveries: DeliveryItem[]) {
  return deliveries.map((delivery, index) => ({
    index,
    fileName: delivery.fileName,
    status: delivery.status || 'pending',
    messageId: delivery.messageId || '',
    error: delivery.error || '',
    sentAt: delivery.sentAt || '',
  }));
}

function reconcileDeliveriesFromBusinessRecords(
  deliveries: DeliveryItem[],
  records: BusinessRecommendation[],
): { deliveries: DeliveryItem[]; changed: boolean } {
  const recordsByIndex = new Map(records.map((record) => [Number(record.deliveryIndex), record]));
  let changed = false;
  const reconciled = deliveries.map((delivery, index) => {
    const record = recordsByIndex.get(index);
    const messageId = cleanText(record?.telegramMessageId, 120);
    const deliveredAt = cleanText(record?.deliveredAt, 120);
    const delivered = record?.deliveryStatus === 'sent' || Boolean(messageId);
    if (!delivered || delivery.status === 'sent' && (!messageId || delivery.messageId === messageId)) return delivery;
    changed = true;
    const next = {
      ...delivery,
      status: 'sent' as const,
      messageId: messageId || delivery.messageId,
      sentAt: deliveredAt || delivery.sentAt || new Date().toISOString(),
    };
    delete next.error;
    return next;
  });
  return { deliveries: reconciled, changed };
}

function safeFileName(value: string): string {
  return value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180) || 'resume.pdf';
}

function cleanText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function sameOptionalValue(left: unknown, right: unknown): boolean {
  const normalizedLeft = cleanText(left, 300).toLowerCase();
  const normalizedRight = cleanText(right, 300).toLowerCase();
  return !normalizedLeft || !normalizedRight || normalizedLeft === normalizedRight;
}

async function repushResumeError(
  deliveries: Array<{ application?: DeliveryApplicationInput }>,
  fileUrl: string,
  sender: 'a' | 'b',
): Promise<string> {
  const repushDeliveries = deliveries.filter((item) => item.application?.source === 'repush');
  if (!repushDeliveries.length) return '';

  const sourceIds = repushDeliveries
    .map((item) => cleanText(item.application?.repushSourceId, 240))
    .filter(Boolean);
  const records = await kvFindRepushRecords({
    sourceIds,
    candidateCodes: repushDeliveries.map((item) => cleanText(item.application?.candidateCode, 80)),
    candidateIdentityIds: repushDeliveries.map((item) => cleanText(item.application?.candidateIdentityId, 300)),
    resumeUrls: [fileUrl],
    column: sender,
  }) as RepushSourceRecord[];
  const sourceById = new Map(records.map((record) => [record.id, record]));

  for (const item of repushDeliveries) {
    const application = item.application!;
    const sourceId = cleanText(application.repushSourceId, 240);
    const candidateCode = cleanText(application.candidateCode, 80).toLowerCase();
    const candidateIdentityId = cleanText(application.candidateIdentityId, 300).toLowerCase();
    const candidateName = cleanText(application.candidateName, 200).toLowerCase();
    const resumeFileName = cleanText(application.resumeFileName, 180).toLowerCase();
    const source = sourceById.get(sourceId) || records.find((record) => (
      record.column === sender
      && cleanText(record.resumeUrl, 1000) === fileUrl
      && (
        Boolean(candidateCode) && cleanText(record.candidateCode, 80).toLowerCase() === candidateCode
        || Boolean(candidateIdentityId) && cleanText(record.candidateIdentityId, 300).toLowerCase() === candidateIdentityId
        || Boolean(candidateName) && candidateName === cleanText(record.candidateName, 200).toLowerCase()
          && Boolean(resumeFileName)
          && resumeFileName === cleanText(record.resumeFileName || record.fileName, 180).toLowerCase()
      )
    ));
    if (!sourceId || !source || source.column !== sender) return '复推来源无法核对，已停止发送，请刷新后重试';

    const originalCandidateName = cleanText(application.candidateName, 200);
    const originalResumeFileName = cleanText(application.resumeFileName, 180);
    const sourceCandidateName = cleanText(source.candidateName, 200) || originalCandidateName;
    const sourceResumeFileName = cleanText(source.resumeFileName || source.fileName, 180);
    if (!sameOptionalValue(originalCandidateName, source.candidateName)
      || !sameOptionalValue(application.candidateCode, source.candidateCode)
      || !sameOptionalValue(application.candidateIdentityId, source.candidateIdentityId)
      || cleanText(source.resumeUrl, 1000) !== fileUrl
      || !sameOptionalValue(originalResumeFileName, sourceResumeFileName)
      || !resumeFileMatchesCandidate(sourceCandidateName, sourceResumeFileName)) {
      return `${originalCandidateName || '该候选人'}的身份与简历文件不一致，已停止发送，请先核对简历`;
    }
  }
  return '';
}

type BusinessRecommendation = Record<string, unknown> & {
  id: string;
  column: 'a' | 'b';
  deliveryId?: string;
  deliveryIndex?: number;
};

function parseBusinessRecommendations(raw: string | null): BusinessRecommendation[] {
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('推荐记录格式异常');
  if (parsed.some((item) => !(
    item && typeof item === 'object' && !Array.isArray(item)
    && typeof (item as BusinessRecommendation).id === 'string'
  ))) throw new Error('推荐记录格式异常');
  return parsed as BusinessRecommendation[];
}

async function deliveryBusinessRecords(record: DeliveryRecord): Promise<BusinessRecommendation[]> {
  const sender = record.sender === 'b' ? 'b' : 'a';
  const records = parseBusinessRecommendations(await kvCommandStrict<string | null>('GET', 'recruit:repush'));
  return records
    .filter((item) => item.deliveryId === record.id && item.column === sender)
    .sort((a, b) => Number(a.deliveryIndex ?? Number.MAX_SAFE_INTEGER) - Number(b.deliveryIndex ?? Number.MAX_SAFE_INTEGER));
}

function deliverySnapshot(
  record: DeliveryRecord,
  deliveries: DeliveryItem[],
  records: BusinessRecommendation[] = [],
) {
  return {
    id: record.id,
    status: publicStatus(record, deliveries),
    sent: sentCount(deliveries),
    total: deliveries.length,
    deliveries: deliveryResults(deliveries),
    applications: record.applications || [],
    records,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt || record.createdAt,
  };
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireApiSession(request);
  if (unauthorized) return unauthorized;

  let body: {
    requestId?: string;
    retry?: boolean;
    target?: string;
    text?: string;
    fileUrl?: string;
    fileName?: string;
    deliveries?: Array<{ text?: string; fileName?: string; application?: DeliveryApplicationInput }>;
    sender?: 'a' | 'b';
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: '请求格式错误' }, { status: 400 });
  }

  const target = body.target?.trim() || '';
  const sender: 'a' | 'b' = body.sender === 'b' ? 'b' : 'a';
  const ownerBlocked = await requireOwnerSession(request, sender, true);
  if (ownerBlocked) return ownerBlocked;
  const rateBlocked = guardApi(request, 'tg-send-recommendation', 12, 60_000);
  if (rateBlocked) return rateBlocked;
  const fileUrl = body.fileUrl?.trim() || '';
  const requestId = body.requestId?.trim() || '';
  if (requestId && !/^[A-Za-z0-9-]{8,80}$/.test(requestId)) {
    return NextResponse.json({ ok: false, error: '发送请求编号无效' }, { status: 400 });
  }
  const id = requestId || `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const existingRaw = await kvCommandStrict<string | null>('GET', recordKey(id));
  const existing = parseRecord(existingRaw);
  if (existing) {
    const existingSender: 'a' | 'b' = existing.sender === 'b' ? 'b' : 'a';
    const existingOwnerBlocked = await requireOwnerSession(request, existingSender, Boolean(body.retry));
    if (existingOwnerBlocked) return existingOwnerBlocked;
    if (existingSender !== sender) {
      return NextResponse.json({ ok: false, error: '发送任务所属人与请求不一致' }, { status: 409 });
    }
    let businessRecords: BusinessRecommendation[];
    try { businessRecords = await deliveryBusinessRecords(existing); }
    catch { return NextResponse.json({ ok: false, error: '推荐记录格式异常，已停止发送' }, { status: 503 }); }
    const reconciled = reconcileDeliveriesFromBusinessRecords(normalizedDeliveries(existing), businessRecords);
    const deliveries = reconciled.deliveries;
    const sent = sentCount(deliveries);
    const status = publicStatus(existing, deliveries);
    if (body.retry && (status === 'failed' || status === 'partial_failed')) {
      if (!await workerIsOnline(existingSender)) {
        return NextResponse.json(
          { ok: false, error: 'TG 发送器当前离线，请确认工作站代理已连接后重试' },
          { status: 503 },
        );
      }
      existing.deliveries = deliveries.map((delivery) => {
        if (delivery.status === 'sent') return delivery;
        const pending = { ...delivery, status: 'pending' as const };
        delete pending.error;
        return pending;
      });
      existing.status = 'queued';
      existing.sent = sent;
      existing.sender = existingSender;
      existing.updatedAt = new Date().toISOString();
      existing.queuedAt = existing.updatedAt;
      existing.retryCount = (existing.retryCount || 0) + 1;
      delete existing.error;
      delete existing.finishedAt;
      delete existing.lease;
      const queued = await requeueDelivery(existing, existingRaw || '', existingSender);
      if (!queued) {
        return NextResponse.json({ ok: false, error: '发送任务状态已更新，请重试' }, { status: 409 });
      }
      businessRecords = await deliveryBusinessRecords(existing);
      return NextResponse.json({
        ok: true,
        queued: true,
        ...deliverySnapshot(existing, existing.deliveries, businessRecords),
      });
    }
    if (status === 'failed' || status === 'partial_failed') {
      return NextResponse.json({
        ok: false,
        ...deliverySnapshot(existing, deliveries, businessRecords),
        error: existing.error || 'TG 发送失败',
      }, { status: 502 });
    }
    return NextResponse.json({
      ok: true,
      queued: status === 'queued' || status === 'sending',
      ...deliverySnapshot(existing, deliveries, businessRecords),
    });
  }

  if (body.retry) {
    return NextResponse.json({ ok: false, error: '未找到可重试的发送记录' }, { status: 404 });
  }

  const requestedDeliveries = body.deliveries?.length
    ? body.deliveries
    : [{ text: body.text, fileName: body.fileName }];
  if (requestedDeliveries.length > 10) {
    return NextResponse.json({ ok: false, error: '一次最多发送 10 个岗位' }, { status: 400 });
  }
  if (!body.deliveries?.length || requestedDeliveries.some((item) => (
    !item.application || !cleanText(item.application.jdId, 240)
    || !cleanText(item.application.candidateName, 200)
    || !cleanText(item.application.jdTitle, 300)
    || !cleanText(item.text, 1000)
  ))) {
    return NextResponse.json({ ok: false, error: '缺少岗位投递信息，未加入发送队列' }, { status: 400 });
  }
  const jdIds = requestedDeliveries.map((item) => cleanText(item.application?.jdId, 240));
  if (new Set(jdIds).size !== jdIds.length) {
    return NextResponse.json({ ok: false, error: '同一发送任务中岗位不能重复' }, { status: 400 });
  }
  const deliveries: DeliveryItem[] = requestedDeliveries
    .map((item) => ({
      text: item.text?.trim() || '',
      fileName: safeFileName(item.fileName || 'resume.pdf'),
      status: 'pending' as const,
    }));
  if (!target || !fileUrl || deliveries.length === 0) {
    return NextResponse.json({ ok: false, error: '接收人、推荐文案和简历均不能为空' }, { status: 400 });
  }
  const urlError = blobUrlError(fileUrl);
  if (urlError) return NextResponse.json({ ok: false, error: urlError }, { status: 400 });

  try {
    const identityError = await repushResumeError(requestedDeliveries, fileUrl, sender);
    if (identityError) return NextResponse.json({ ok: false, error: identityError }, { status: 409 });
  } catch {
    return NextResponse.json({ ok: false, error: '复推简历核对失败，已停止发送，请稍后重试' }, { status: 503 });
  }

  if (!await workerIsOnline(sender)) {
    return NextResponse.json(
      { ok: false, error: 'TG 发送器当前离线，请确认工作站代理已连接后重试' },
      { status: 503 },
    );
  }

  const createdAt = new Date().toISOString();
  const applications: DeliveryApplication[] = requestedDeliveries.map((item, index) => ({
    index,
    applicationId: `${id}:${cleanText(item.application?.jdId, 240)}`,
    jdId: cleanText(item.application?.jdId, 240),
  }));
  const businessRecords: BusinessRecommendation[] = requestedDeliveries.map((item, index) => {
    const application = item.application!;
    const candidateName = cleanText(application.candidateName, 200);
    const jdTitle = cleanText(application.jdTitle, 300);
    const applicationId = applications[index].applicationId;
    return {
      id: applicationId,
      applicationId,
      column: sender,
      fileName: jdTitle ? `${candidateName}-${jdTitle}` : candidateName,
      candidateCode: cleanText(application.candidateCode, 80) || undefined,
      candidateIdentityId: cleanText(application.candidateIdentityId, 240) || undefined,
      candidateName,
      jdId: applications[index].jdId,
      jdTitle,
      contact: cleanText(application.contact, 300) || undefined,
      contactPerson: cleanText(application.contactPerson, 200) || undefined,
      rawText: cleanText(item.text, 2000) || undefined,
      highlights: cleanText(application.highlights, 1500) || undefined,
      resumeUrl: fileUrl,
      resumeFileName: safeFileName(cleanText(application.resumeFileName, 180) || item.fileName || 'resume.pdf'),
      source: application.source === 'repush' ? 'repush' : 'intake',
      repushSourceId: cleanText(application.repushSourceId, 240) || undefined,
      deliveryId: id,
      deliveryIndex: index,
      deliveryStatus: 'queued',
      deliveryUpdatedAt: createdAt,
      feedback: 'pending',
      interviewStatus: 'none',
      organization: cleanText(application.organization, 300) || undefined,
      department: cleanText(application.department, 300) || undefined,
      uploadedAt: createdAt,
      updatedAt: createdAt,
    };
  });
  const record: DeliveryRecord = {
    id,
    status: 'queued',
    createdAt,
    updatedAt: createdAt,
    queuedAt: createdAt,
    target,
    fileUrl,
    deliveries,
    applications,
    sender,
  };
  const queued = await enqueueDelivery(record, businessRecords, sender);
  if (queued < 0) {
    return NextResponse.json({ ok: false, error: queued === -2 ? '投递记录已存在，请刷新后核对' : '推荐记录格式异常，已停止发送' }, { status: queued === -2 ? 409 : 503 });
  }
  if (queued !== 1) {
    return NextResponse.json({ ok: false, error: '相同发送任务已创建，请重试读取状态' }, { status: 409 });
  }
  return NextResponse.json({
    ok: true,
    queued: true,
    ...deliverySnapshot(record, deliveries, businessRecords),
  });
}

export async function GET(request: NextRequest) {
  const unauthorized = await requireApiSession(request);
  if (unauthorized) return unauthorized;
  const blocked = guardApi(request, 'tg-send-status', 60, 60_000);
  if (blocked) return blocked;
  const id = request.nextUrl.searchParams.get('id')?.trim() || '';
  if (!id || !/^[A-Za-z0-9-]+$/.test(id)) {
    return NextResponse.json({ ok: false, error: '发送编号无效' }, { status: 400 });
  }
  const record = parseRecord(await kvCommandStrict<string | null>('GET', recordKey(id)));
  if (!record) return NextResponse.json({ ok: false, error: '未找到发送记录' }, { status: 404 });
  const ownerBlocked = await requireOwnerSession(request, record.sender === 'b' ? 'b' : 'a');
  if (ownerBlocked) return ownerBlocked;
  let businessRecords: BusinessRecommendation[];
  try { businessRecords = await deliveryBusinessRecords(record); }
  catch { return NextResponse.json({ ok: false, error: '推荐记录格式异常，已停止读取' }, { status: 503 }); }
  const reconciled = reconcileDeliveriesFromBusinessRecords(normalizedDeliveries(record), businessRecords);
  const deliveries = reconciled.deliveries;
  const status = publicStatus(record, deliveries);
  if (reconciled.changed && status === 'sent' && record.status !== 'sending') {
    record.deliveries = deliveries;
    record.sent = deliveries.length;
    record.status = 'sent';
    record.finishedAt ||= new Date().toISOString();
    record.updatedAt = new Date().toISOString();
    delete record.error;
    delete record.lease;
    await kvCommandStrict('SET', recordKey(id), JSON.stringify(record), 'EX', DELIVERY_TTL_SECONDS);
  }
  if (status === 'sent' && !record.cleanedAt) {
    try {
      const pathname = new URL(record.fileUrl).pathname;
      if (pathname.startsWith('/tg-delivery/')) {
        await del(record.fileUrl);
        record.cleanedAt = new Date().toISOString();
        await kvCommandStrict('SET', recordKey(id), JSON.stringify(record), 'EX', DELIVERY_TTL_SECONDS);
      }
    } catch {
      // Cleanup is best-effort and must never turn a successful TG delivery into a failure.
    }
  }
  return NextResponse.json({
    ok: true,
    ...deliverySnapshot(record, deliveries, businessRecords),
    error: record.error || '',
    finishedAt: record.finishedAt || '',
  });
}
