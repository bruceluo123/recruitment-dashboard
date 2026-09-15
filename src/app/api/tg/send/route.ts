import { NextRequest, NextResponse } from 'next/server';
import { del } from '@vercel/blob';
import { blobUrlError, guardApi } from '@/lib/api-guard';
import { requireApiSession, requireOwnerSession } from '@/lib/auth-api';
import { kvCommandStrict, kvTransaction } from '@/lib/kv-server';

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

function repushResumeError(
  deliveries: Array<{ application?: DeliveryApplicationInput }>,
  fileUrl: string,
  sender: 'a' | 'b',
  records: RepushSourceRecord[],
): string {
  const repushDeliveries = deliveries.filter((item) => item.application?.source === 'repush');
  if (!repushDeliveries.length) return '';

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
    const sourceResumeFileName = cleanText(source.resumeFileName || source.fileName, 180);
    // 文件名可用中文名、英文名或职位名；附件归属由来源记录及 URL 核对，不能靠文件名猜姓名。
    if (!sameOptionalValue(originalCandidateName, source.candidateName)
      || !sameOptionalValue(application.candidateCode, source.candidateCode)
      || !sameOptionalValue(application.candidateIdentityId, source.candidateIdentityId)) {
      return `${originalCandidateName || '该候选人'}的人选资料与原推荐记录不同，请重新打开复推窗口读取最新资料`;
    }
    if (cleanText(source.resumeUrl, 1000) !== fileUrl) {
      return `${originalCandidateName || '该候选人'}的简历附件与原推荐记录不同，请重新打开复推窗口选择当前附件`;
    }
    if (!sameOptionalValue(originalResumeFileName, sourceResumeFileName)) {
      return `${originalCandidateName || '该候选人'}的附件名称已更新，请重新打开复推窗口读取最新附件`;
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


interface SendInput {
  requestId?: string;
  retry?: boolean;
  retryIfFailed?: boolean;
  target?: string;
  text?: string;
  fileUrl?: string;
  fileName?: string;
  deliveries?: Array<{ text?: string; fileName?: string; application?: DeliveryApplicationInput }>;
  sender?: 'a' | 'b';
  sourceSnapshot?: RepushSourceRecord;
}

function prepareDelivery(body: SendInput, id: string, sender: 'a' | 'b') {
  const target = cleanText(body.target, 300);
  const fileUrl = cleanText(body.fileUrl, 1000);
  const requestedDeliveries = body.deliveries?.length
    ? body.deliveries
    : [{ text: body.text, fileName: body.fileName }];
  if (requestedDeliveries.length > 10) {
    throw new Error('一次最多发送 10 个岗位');
  }
  if (!body.deliveries?.length || requestedDeliveries.some((item) => (
    !item.application || !cleanText(item.application.jdId, 240)
    || !cleanText(item.application.candidateName, 200)
    || !cleanText(item.application.jdTitle, 300)
    || !cleanText(item.text, 1000)
  ))) {
    throw new Error('缺少岗位投递信息，未加入发送队列');
  }
  const jdIds = requestedDeliveries.map((item) => cleanText(item.application?.jdId, 240));
  if (new Set(jdIds).size !== jdIds.length) {
    throw new Error('同一发送任务中岗位不能重复');
  }
  const deliveries: DeliveryItem[] = requestedDeliveries
    .map((item) => ({
      text: item.text?.trim() || '',
      fileName: safeFileName(item.fileName || 'resume.pdf'),
      status: 'pending' as const,
    }));
  if (!target || !fileUrl || deliveries.length === 0) {
    throw new Error('接收人、推荐文案和简历均不能为空');
  }
  const urlError = blobUrlError(fileUrl);
  if (urlError) throw new Error(urlError);

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

  return { record, businessRecords };
}

// One read and one compare-and-swap for the whole batch. A lost response can be
// retried with the same IDs: existing tasks are returned without re-enqueueing.
async function submitDeliveries(inputs: SendInput[], sender: 'a' | 'b') {
  const jobs = inputs.map(input => ({
    ...input,
    requestId: cleanText(input.requestId, 80) || crypto.randomUUID(),
  }));
  const keys = ['recruit:repush', 'recruit:tombstones', accountKeys(sender).heartbeat,
    ...jobs.map(job => recordKey(job.requestId))];
  for (let attempt = 0; attempt < 3; attempt++) {
    const raw = await kvCommandStrict<(string | null)[]>('MGET', ...keys);
    let repush = parseBusinessRecommendations(raw[0]);
    const tombstones = raw[1] ? JSON.parse(raw[1]) : {};
    const heartbeat = parseHeartbeat(raw[2]);
    const online = Boolean(heartbeat?.at && Date.now() - Date.parse(heartbeat.at) <= 45_000);
    const writes: NonNullable<Parameters<typeof kvTransaction>[0]['writes']> = [];
    const expected: NonNullable<Parameters<typeof kvTransaction>[0]['expected']> = [];
    const lists: NonNullable<Parameters<typeof kvTransaction>[0]['lists']> = [];
    const results: Array<ReturnType<typeof deliverySnapshot> & { ok: boolean; error?: string } | { id: string; ok: false; error: string }> = [];
    for (const [index, body] of Array.from(jobs.entries())) {
      const id = body.requestId;
      try {
        const existing = parseRecord(raw[index + 3]);
        if (existing) {
          if ((existing.sender || 'a') !== sender) throw new Error('发送任务所属人与请求不一致');
          if (body.target && existing.target !== body.target.trim()
            || body.fileUrl && existing.fileUrl !== body.fileUrl.trim()) {
            throw new Error('发送任务内容已变化，请重新选择推荐岗位');
          }
          const records = repush.filter(row => row.deliveryId === id && row.column === sender);
          const deliveries = reconcileDeliveriesFromBusinessRecords(normalizedDeliveries(existing), records).deliveries;
          const status = publicStatus(existing, deliveries);
          if ((body.retry || body.retryIfFailed) && (status === 'failed' || status === 'partial_failed')) {
            if (!online) throw new Error('TG 发送器当前离线，请确认工作站代理已连接后重试');
            const now = new Date().toISOString();
            const retryRecord: DeliveryRecord = {
              ...existing, deliveries: deliveries.map(delivery => {
                if (delivery.status === 'sent') return delivery;
                const next = { ...delivery, status: 'pending' as const };
                delete next.error;
                return next;
              }),
              sent: sentCount(deliveries), status: 'queued', updatedAt: now, queuedAt: now,
              retryCount: (existing.retryCount || 0) + 1,
            };
            delete retryRecord.error; delete retryRecord.finishedAt; delete retryRecord.lease;
            repush = repush.map(row => row.deliveryId === id && row.column === sender
              && retryRecord.deliveries[Number(row.deliveryIndex)]?.status === 'pending'
              ? { ...row, deliveryStatus: 'queued', deliveryUpdatedAt: now, telegramMessageId: undefined, deliveredAt: undefined }
              : row);
            writes.push({ key: recordKey(id), value: JSON.stringify(retryRecord), ttlSeconds: DELIVERY_TTL_SECONDS });
            expected.push({ key: recordKey(id), exists: true, value: raw[index + 3]! });
            lists.push({ op: 'push', key: accountKeys(sender).queue, value: id });
            results.push({ ok: true, ...deliverySnapshot(retryRecord, retryRecord.deliveries,
              repush.filter(row => row.deliveryId === id && row.column === sender)) });
          } else {
            results.push({ ok: status !== 'failed' && status !== 'partial_failed',
              ...deliverySnapshot(existing, deliveries, records), error: existing.error });
          }
          continue;
        }
        if (body.retry) throw new Error('未找到可重试的发送记录');
        const { record, businessRecords } = prepareDelivery(body, id, sender);
        if (!online) throw new Error('TG 发送器当前离线，请确认工作站代理已连接后重试');
        const deliveries = body.deliveries!;
        const sourceIds = deliveries.filter(row => row.application?.source === 'repush')
          .map(row => cleanText(row.application?.repushSourceId, 240));
        if (sourceIds.some(sourceId => tombstones?.repush?.[sourceId])) {
          throw new Error('原推荐已被删除，已停止发送，请核对推荐记录');
        }
        let source: RepushSourceRecord | undefined;
        const snapshot = body.sourceSnapshot;
        if (snapshot && sourceIds.includes(snapshot.id) && !repush.some(row => row.id === snapshot.id)) {
          if (snapshot.column !== sender || !cleanText(snapshot.candidateName, 200)
            || !cleanText(snapshot.fileName, 180) || !Number.isFinite(Date.parse(String(snapshot.uploadedAt || '')))
            || JSON.stringify(snapshot).length > 50_000
            || Object.keys(snapshot).some(key => ['__proto__', 'constructor', 'prototype'].includes(key))) {
            throw new Error('原推荐记录不完整或所属人不一致，请核对后重试');
          }
          source = snapshot;
        }
        const identityError = repushResumeError(deliveries, record.fileUrl, sender,
          [...repush, ...(source ? [source] : [])] as RepushSourceRecord[]);
        if (identityError) throw new Error(identityError);
        const ids = new Set(repush.flatMap(row => [row.id, row.applicationId].filter(Boolean)));
        if (businessRecords.some(row => ids.has(row.id) || source?.id === row.id)) {
          throw new Error('投递记录已存在，请刷新后核对');
        }
        // Restore source and enqueue only after every check succeeds, in the same transaction.
        repush = [...repush, ...(source ? [source] : []), ...businessRecords];
        writes.push({ key: recordKey(id), value: JSON.stringify(record), ttlSeconds: DELIVERY_TTL_SECONDS });
        expected.push({ key: recordKey(id), exists: false });
        lists.push({ op: 'push', key: accountKeys(sender).queue, value: id });
        results.push({ ok: true, ...deliverySnapshot(record, record.deliveries, businessRecords) });
      } catch (error) {
        results.push({ id, ok: false, error: error instanceof Error ? error.message : '发送信息无效' });
      }
    }
    if (!writes.length) return results;
    const committed = await kvTransaction({
      expected: [
        { key: keys[0], exists: raw[0] !== null, ...(raw[0] !== null ? { value: raw[0] } : {}) },
        { key: keys[1], exists: raw[1] !== null, ...(raw[1] !== null ? { value: raw[1] } : {}) },
        ...expected,
      ],
      writes: [...writes, { key: keys[0], value: JSON.stringify(repush) }],
      lists, increments: ['recruit:version'],
    });
    if (committed.ok) return results;
  }
  throw new Error('推荐数据正在更新，请重试；同一任务不会重复入队');
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireApiSession(request);
  if (unauthorized) return unauthorized;
  let body: SendInput & { batch?: SendInput[] };
  try { body = await request.json(); }
  catch { return NextResponse.json({ ok: false, error: '请求格式错误' }, { status: 400 }); }
  if (!body || typeof body !== 'object') return NextResponse.json({ ok: false, error: '请求格式错误' }, { status: 400 });
  const sender = body.sender === 'b' ? 'b' : 'a';
  const ownerBlocked = await requireOwnerSession(request, sender, true);
  if (ownerBlocked) return ownerBlocked;
  const rateBlocked = guardApi(request, 'tg-send-recommendation', 12, 60_000);
  if (rateBlocked) return rateBlocked;
  const jobs = body.batch === undefined ? [body] : body.batch;
  if (!Array.isArray(jobs) || !jobs.length || jobs.length > 10 || jobs.some(job => !job
    || typeof job !== 'object' || job.sender && job.sender !== sender
    || job.requestId !== undefined && (typeof job.requestId !== 'string' || !/^[A-Za-z0-9-]{8,80}$/.test(job.requestId))
    || body.batch !== undefined && !job.requestId)) {
    return NextResponse.json({ ok: false, error: '发送任务格式无效，一次最多 10 位人选' }, { status: 400 });
  }
  const ids = jobs.map(job => job.requestId).filter(Boolean);
  if (new Set(ids).size !== ids.length) return NextResponse.json({ ok: false, error: '发送任务编号重复' }, { status: 400 });
  try {
    const results = await submitDeliveries(jobs, sender);
    if (body.batch !== undefined) return NextResponse.json({ ok: true, results });
    const result = results[0];
    return NextResponse.json({ ...result, queued: result.ok && 'status' in result
      && (result.status === 'queued' || result.status === 'sending') }, { status: result.ok ? 200 : 409 });
  } catch {
    return NextResponse.json({ ok: false, error: '发送任务暂时无法确认，请重试；已提交的任务不会重复入队' }, { status: 503 });
  }
}

export async function GET(request: NextRequest) {
  const unauthorized = await requireApiSession(request);
  if (unauthorized) return unauthorized;
  const blocked = guardApi(request, 'tg-send-status', 60, 60_000);
  if (blocked) return blocked;
  const batchIds = request.nextUrl.searchParams.getAll('ids');
  if (batchIds.length) {
    if (batchIds.length > 10 || batchIds.some(id => !/^[A-Za-z0-9-]{8,80}$/.test(id))) {
      return NextResponse.json({ ok: false, error: '发送编号无效' }, { status: 400 });
    }
    try {
      const values = await kvCommandStrict<(string | null)[]>('MGET', 'recruit:repush', ...batchIds.map(recordKey));
      const records = parseBusinessRecommendations(values[0]);
      const permissions = new Map<'a' | 'b', boolean>();
      const results = [];
      for (const [index, id] of Array.from(batchIds.entries())) {
        const record = parseRecord(values[index + 1]);
        if (!record) { results.push({ id, ok: false, error: '未找到发送记录' }); continue; }
        const sender = record.sender === 'b' ? 'b' : 'a';
        if (!permissions.has(sender)) permissions.set(sender, !await requireOwnerSession(request, sender));
        if (!permissions.get(sender)) { results.push({ id, ok: false, error: '无权读取该发送任务' }); continue; }
        const business = records.filter(row => row.deliveryId === id && row.column === sender);
        const deliveries = reconcileDeliveriesFromBusinessRecords(normalizedDeliveries(record), business).deliveries;
        results.push({ ok: true, ...deliverySnapshot(record, deliveries, business), error: record.error || '' });
      }
      return NextResponse.json({ ok: true, results });
    } catch {
      return NextResponse.json({ ok: false, error: '发送进度读取失败，已保留上次结果' }, { status: 503 });
    }
  }
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
