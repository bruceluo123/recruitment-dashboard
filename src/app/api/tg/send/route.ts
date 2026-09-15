import { NextRequest, NextResponse } from 'next/server';
import { blobUrlError, guardApi } from '@/lib/api-guard';
import { apiSessionUser, requireApiSession, requireOwnerSession } from '@/lib/auth-api';
import { kvCommandStrict, kvFindRepushRecords, kvTransaction } from '@/lib/kv-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Leave room for receipt recovery after a storage timeout; normal requests do not wait.
export const maxDuration = 60;

const recordKey = (id: string) => `recruit:tg-delivery:${id}`;
// Keep the authoritative receipt across browser resets and delayed retries.
// An intentional repeat uses a new request ID, not expiry of the previous send.

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
  businessRecords?: BusinessRecommendation[];
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
  try {
    const record = typeof value === 'string' ? JSON.parse(value) : value;
    return record && typeof record === 'object' && typeof record.id === 'string'
      && Array.isArray(record.deliveries)
      && record.deliveries.every((item: unknown) => item && typeof item === 'object' && !Array.isArray(item))
      ? record as DeliveryRecord : null;
  } catch { return null; }
}

function parseHeartbeat(value: WorkerHeartbeat | string | null): WorkerHeartbeat | null {
  if (!value) return null;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value) as WorkerHeartbeat; } catch { return null; }
}

function normalizedDeliveries(record: DeliveryRecord): DeliveryItem[] {
  const legacySent = Math.max(0, Number(record.sent) || 0);
  return (record.deliveries || []).map((delivery, index) => {
    const recordedSuccess = delivery.status === 'sent' || delivery.messageId != null
      || (!record.deliveries.some(item => item.status || item.messageId) && index < legacySent);
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
    const sameCandidate = (Boolean(candidateCode)
      && candidateCode === cleanText(source.candidateCode, 80).toLowerCase())
      || (Boolean(candidateIdentityId)
      && candidateIdentityId === cleanText(source.candidateIdentityId, 300).toLowerCase());
    // 已核对固定编号时允许姓名别名；编号冲突、附件 URL 不同仍阻止发送。
    // 文件名仅为显示元数据，重命名不代表附件被更换。
    if ((!sameCandidate && !sameOptionalValue(originalCandidateName, source.candidateName))
      || !sameOptionalValue(application.candidateCode, source.candidateCode)
      || !sameOptionalValue(application.candidateIdentityId, source.candidateIdentityId)) {
      return `${originalCandidateName || '该候选人'}的人选资料与原推荐记录不同，请重新打开复推窗口读取最新资料`;
    }
    if (cleanText(source.resumeUrl, 1000) !== fileUrl) {
      return `${originalCandidateName || '该候选人'}的简历附件与原推荐记录不同，请重新打开复推窗口选择当前附件`;
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

async function deliveryBusinessRecords(tasks: DeliveryRecord[]): Promise<BusinessRecommendation[]> {
  const groups = await Promise.all((['a', 'b'] as const).map(async (sender) => {
    const owned = tasks.filter(task => (task.sender || 'a') === sender && !task.businessRecords);
    if (!owned.length) return [];
    const ids = new Set(owned.map(task => task.id));
    const records = await kvFindRepushRecords({
      sourceIds: owned.flatMap(task => (task.applications || []).map(app => app.applicationId)),
      candidateCodes: [], candidateIdentityIds: [],
      resumeUrls: owned.map(task => task.fileUrl), column: sender,
    });
    return records.filter(item => ids.has(String(item.deliveryId)) && item.column === sender) as BusinessRecommendation[];
  }));
  return [...groups.flat(), ...tasks.flatMap(task => task.businessRecords || [])]
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
    records: records.map(row => {
      const delivery = deliveries[Number(row.deliveryIndex)];
      if (!delivery) return row;
      return { ...row,
        deliveryStatus: delivery.status === 'pending' ? 'queued' : delivery.status,
        deliveryUpdatedAt: record.updatedAt || record.createdAt,
        telegramMessageId: delivery.messageId || undefined,
        deliveredAt: delivery.sentAt || undefined,
      };
    }),
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
  if (requestedDeliveries.some(item => typeof item.text !== 'string' || item.text.length > 20_000)) {
    throw new Error('单份推荐文案最多 20000 字符，请核对内容');
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
      rawText: item.text?.trim() || undefined,
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
    businessRecords,
    sender,
  };

  return { record, businessRecords };
}

// The task is the durable outbox. Shared recommendation projection must never
// participate in enqueue/lease CAS or make unrelated users block each other.
async function submitDeliveries(inputs: SendInput[], sender: 'a' | 'b') {
  const jobs = inputs.map(input => ({
    ...input,
    requestId: cleanText(input.requestId, 80) || crypto.randomUUID(),
  }));
  const keys = ['recruit:tombstones', accountKeys(sender).heartbeat,
    ...jobs.map(job => recordKey(job.requestId))];
  const deadline = Date.now() + 18_000;
  for (let attempt = 0; attempt < 3; attempt++) {
    let raw: (string | null)[];
    try {
      raw = await kvCommandStrict<(string | null)[]>('MGET', ...keys);
    } catch (error) {
      if (attempt === 2 || Date.now() >= deadline) throw error;
      continue;
    }
    const tombstones = raw[0] ? JSON.parse(raw[0]) : {};
    const heartbeat = parseHeartbeat(raw[1]);
    const newRepush = jobs.filter((job, index) => !raw[index + 2]
      && job.deliveries?.some(item => item.application?.source === 'repush'));
    let sources: RepushSourceRecord[] = [];
    let sourceReadError = false;
    if (newRepush.length) {
      try {
        sources = await kvFindRepushRecords({
          sourceIds: newRepush.flatMap(job => (job.deliveries || []).map(item => cleanText(item.application?.repushSourceId, 240))),
          candidateCodes: [], candidateIdentityIds: [],
          resumeUrls: newRepush.map(job => cleanText(job.fileUrl, 1000)), column: sender,
        }) as RepushSourceRecord[];
      } catch { sourceReadError = true; }
    }
    const online = Boolean(heartbeat?.at && Date.now() - Date.parse(heartbeat.at) <= 45_000);
    const writes: NonNullable<Parameters<typeof kvTransaction>[0]['writes']> = [];
    const expected: NonNullable<Parameters<typeof kvTransaction>[0]['expected']> = [];
    const lists: NonNullable<Parameters<typeof kvTransaction>[0]['lists']> = [];
    const results: Array<ReturnType<typeof deliverySnapshot> & { ok: boolean; error?: string } | { id: string; ok: false; error: string }> = [];
    for (const [index, body] of Array.from(jobs.entries())) {
      const id = body.requestId;
      try {
        const existing = parseRecord(raw[index + 2]);
        if (existing) {
          if ((existing.sender || 'a') !== sender) throw new Error('发送任务所属人与请求不一致');
          if (body.target && existing.target !== body.target.trim()
            || body.fileUrl && existing.fileUrl !== body.fileUrl.trim()) {
            throw new Error('发送任务内容已变化，请重新选择推荐岗位');
          }
          if (body.deliveries && (body.deliveries.length !== existing.deliveries.length
            || body.deliveries.some((item, itemIndex) => {
              const previous = existing.deliveries[itemIndex];
              const application = existing.applications?.[itemIndex];
              const business = existing.businessRecords?.find(row => row.deliveryIndex === itemIndex);
              return item.text?.trim() !== previous.text || safeFileName(item.fileName || 'resume.pdf') !== previous.fileName
                || (application && cleanText(item.application?.jdId, 240) !== application.jdId)
                || (business && ['candidateCode', 'candidateIdentityId', 'candidateName', 'repushSourceId'].some(field => (
                  cleanText(item.application?.[field as keyof DeliveryApplicationInput], 240) !== cleanText(business[field], 240)
                )));
            }))) throw new Error('同一任务的文案、人选或岗位已变化，请重新生成推荐');
          const records = existing.businessRecords || await deliveryBusinessRecords([existing]);
          const deliveries = existing.businessRecords ? normalizedDeliveries(existing)
            : reconcileDeliveriesFromBusinessRecords(normalizedDeliveries(existing), records).deliveries;
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
            retryRecord.businessRecords = records;
            writes.push({ key: recordKey(id), value: JSON.stringify(retryRecord) });
            expected.push({ key: recordKey(id), exists: true, value: raw[index + 2]! });
            lists.push({ op: 'push', key: accountKeys(sender).queue, value: id });
            results.push({ ok: true, ...deliverySnapshot(retryRecord, retryRecord.deliveries,
              records) });
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
        if (sourceIds.length && sourceReadError) throw new Error('原推荐暂时无法核对，请重试；没有重复入队');
        if (sourceIds.some(sourceId => tombstones?.repush?.[sourceId])) {
          throw new Error('原推荐已被删除，已停止发送，请核对推荐记录');
        }
        let source: RepushSourceRecord | undefined;
        const snapshot = body.sourceSnapshot;
        if (snapshot && sourceIds.includes(snapshot.id) && !sources.some(row => row.id === snapshot.id)) {
          if (snapshot.column !== sender || !cleanText(snapshot.candidateName, 200)
            || !cleanText(snapshot.fileName, 180) || !Number.isFinite(Date.parse(String(snapshot.uploadedAt || '')))
            || JSON.stringify(snapshot).length > 50_000
            || Object.keys(snapshot).some(key => ['__proto__', 'constructor', 'prototype'].includes(key))) {
            throw new Error('原推荐记录不完整或所属人不一致，请核对后重试');
          }
          source = snapshot;
        }
        const identityError = repushResumeError(deliveries, record.fileUrl, sender,
          [...sources, ...(source ? [source] : [])]);
        if (identityError) throw new Error(identityError);
        if (businessRecords.some(row => tombstones?.repush?.[row.id])) {
          throw new Error('该投递记录已被删除，请核对后重新推荐');
        }
        writes.push({ key: recordKey(id), value: JSON.stringify(record) });
        expected.push({ key: recordKey(id), exists: false });
        lists.push({ op: 'push', key: accountKeys(sender).queue, value: id });
        results.push({ ok: true, ...deliverySnapshot(record, record.deliveries, businessRecords) });
      } catch (error) {
        results.push({ id, ok: false, error: error instanceof Error ? error.message : '发送信息无效' });
      }
    }
    if (!writes.length) return results;
    try {
      const committed = await kvTransaction({
        expected: [
          { key: keys[0], exists: raw[0] !== null, ...(raw[0] !== null ? { value: raw[0] } : {}) },
          ...expected,
        ],
        writes,
        lists: [...lists, ...writes.flatMap(write => {
          const task = parseRecord(write.value)!;
          const key = `recruit:tg-delivery-projection-pending${sender === 'b' ? '-b' : ''}`;
          return [{ op: 'remove' as const, key, value: task.id, count: 0 },
            { op: 'push' as const, key, value: task.id }];
        })],
        increments: ['recruit:version'],
      });
      if (committed.ok) return results;
    } catch (error) {
      // The transaction may have committed before its response was lost. Read
      // only its receipts before attempting another compare-and-swap.
      try {
        const receipts = await kvCommandStrict<(string | null)[]>('MGET', ...writes.map(write => write.key));
        const confirmed = receipts.map(parseRecord);
        if (confirmed.every((receipt, index) => {
          const planned = parseRecord(writes[index].value)!;
          return receipt && receipt.id === planned.id && receipt.sender === planned.sender
            && receipt.createdAt === planned.createdAt && receipt.fileUrl === planned.fileUrl
            && receipt.target === planned.target && (receipt.retryCount || 0) >= (planned.retryCount || 0);
        })) {
          return results.map(result => {
            const receipt = confirmed.find(record => record?.id === result.id);
            if (!receipt) return result;
            const business = receipt.businessRecords || [];
            const deliveries = normalizedDeliveries(receipt);
            const status = publicStatus(receipt, deliveries);
            return { ok: status !== 'failed' && status !== 'partial_failed',
              ...deliverySnapshot(receipt, deliveries, business), error: receipt.error };
          });
        }
      } catch {
        // Keep the same IDs and re-read before retrying; never replay a blind write.
      }
      if (attempt === 2 || Date.now() >= deadline) throw error;
    }
    if (Date.now() >= deadline) break;
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
  const actor = (await apiSessionUser(request))?.sub || 'service';
  const rateBlocked = guardApi(request, `tg-send-recommendation:${actor}`, 12, 60_000);
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
  } catch (error) {
    console.error('[tg-send] submit failed', error instanceof Error ? error.name : 'UnknownError');
    return NextResponse.json({ ok: false, error: '发送任务暂时无法确认，请重试；已提交的任务不会重复入队' }, { status: 503 });
  }
}

export async function GET(request: NextRequest) {
  const unauthorized = await requireApiSession(request);
  if (unauthorized) return unauthorized;
  const actor = (await apiSessionUser(request))?.sub || 'service';
  const blocked = guardApi(request, `tg-send-status:${actor}`, 60, 60_000);
  if (blocked) return blocked;
  const batchIds = request.nextUrl.searchParams.getAll('ids');
  if (batchIds.length) {
    if (batchIds.length > 10 || batchIds.some(id => !/^[A-Za-z0-9-]{8,80}$/.test(id))) {
      return NextResponse.json({ ok: false, error: '发送编号无效' }, { status: 400 });
    }
    try {
      const values = await kvCommandStrict<(string | null)[]>('MGET', ...batchIds.map(recordKey));
      const permissions = new Map<'a' | 'b', boolean>();
      const results = [];
      const tasks = values.map(parseRecord);
      for (const task of tasks) {
        if (!task) continue;
        const sender = task.sender === 'b' ? 'b' : 'a';
        if (!permissions.has(sender)) permissions.set(sender, !await requireOwnerSession(request, sender));
      }
      // Receipt checks must stay independent of the multi-MB recommendation
      // snapshot/lookup. They report queue state, not a refreshed business record.
      const records = request.nextUrl.searchParams.get('receipt') === '1'
        ? tasks.filter((task): task is DeliveryRecord => Boolean(task && permissions.get(task.sender || 'a')))
          .flatMap(task => task.businessRecords || [])
        : await deliveryBusinessRecords(tasks.filter((task): task is DeliveryRecord => Boolean(task && permissions.get(task.sender || 'a'))));
      for (const [index, id] of Array.from(batchIds.entries())) {
        const record = tasks[index];
        if (!record) { results.push({ id, ok: false, error: '未找到发送记录' }); continue; }
        const sender = record.sender === 'b' ? 'b' : 'a';
        if (!permissions.has(sender)) permissions.set(sender, !await requireOwnerSession(request, sender));
        if (!permissions.get(sender)) { results.push({ id, ok: false, error: '无权读取该发送任务' }); continue; }
        const business = records.filter(row => row.deliveryId === id && row.column === sender);
        const deliveries = record.businessRecords ? normalizedDeliveries(record)
          : reconcileDeliveriesFromBusinessRecords(normalizedDeliveries(record), business).deliveries;
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
  let record: DeliveryRecord | null;
  try { record = parseRecord(await kvCommandStrict<string | null>('GET', recordKey(id))); }
  catch { return NextResponse.json({ ok: false, error: '发送进度暂时无法读取，请稍后重试' }, { status: 503 }); }
  if (!record) return NextResponse.json({ ok: false, error: '未找到发送记录' }, { status: 404 });
  const ownerBlocked = await requireOwnerSession(request, record.sender === 'b' ? 'b' : 'a');
  if (ownerBlocked) return ownerBlocked;
  let businessRecords: BusinessRecommendation[];
  try { businessRecords = request.nextUrl.searchParams.get('receipt') === '1'
    ? record.businessRecords || [] : await deliveryBusinessRecords([record]); }
  catch { return NextResponse.json({ ok: false, error: '推荐记录格式异常，已停止读取' }, { status: 503 }); }
  const deliveries = record.businessRecords ? normalizedDeliveries(record)
    : reconcileDeliveriesFromBusinessRecords(normalizedDeliveries(record), businessRecords).deliveries;
  // Status reads are read-only. A file may be referenced by several jobs and
  // future repushes; delivery receipts must never delete that attachment.
  return NextResponse.json({
    ok: true,
    ...deliverySnapshot(record, deliveries, businessRecords),
    error: record.error || '',
    finishedAt: record.finishedAt || '',
  });
}
