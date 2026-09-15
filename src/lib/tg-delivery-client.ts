import type { RepushColumnId, RepushItem } from '@/store/repush-store';

export interface DeliveryClientPayload {
  sender: RepushColumnId;
  target: string;
  fileUrl: string;
  deliveries: Array<{ text: string; fileName: string; application: Record<string, unknown> }>;
  sourceSnapshot?: RepushItem;
}

export interface DeliveryClientResult {
  id?: string;
  ok?: boolean;
  queued?: boolean;
  status?: 'queued' | 'sending' | 'sent' | 'failed' | 'partial_failed';
  sent?: number;
  total?: number;
  createdAt?: string;
  updatedAt?: string;
  applications?: Array<{ index: number; applicationId: string; jdId: string }>;
  records?: RepushItem[];
  deliveries?: Array<{ index: number; fileName: string; status: 'pending' | 'sending' | 'sent' | 'failed'; messageId?: string; sentAt?: string; error?: string }>;
  error?: string;
  unconfirmed?: boolean;
}

export type DeliveryClientTask = DeliveryClientPayload & { requestId: string; retryIfFailed: true };

interface DeliveryIntent {
  requestId: string;
  createdAt: string;
  receipt?: DeliveryClientResult;
}

const intentMemory = new Map<string, DeliveryIntent>();
const intentKeyById = new Map<string, string>();
// Older intents require an authoritative receipt check before another submission.
const MAX_UNCONFIRMED_AGE_MS = 6 * 24 * 60 * 60 * 1000;

function readIntent(key: string): DeliveryIntent | undefined {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw) as DeliveryIntent;
      if (parsed.requestId && Number.isFinite(Date.parse(parsed.createdAt))) return parsed;
    }
  } catch { /* Initial sends remain possible when browser storage is unavailable. */ }
  return intentMemory.get(key);
}

function writeIntent(key: string, value: DeliveryIntent, requireDurable = false): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    if (requireDurable) throw new Error('浏览器无法保存再次发送记录，请允许本站存储后重试，避免重复发送');
  }
  intentMemory.set(key, value);
}

function isConfirmedSent(result: DeliveryClientResult): boolean {
  return result.status === 'sent' && Boolean(result.deliveries?.length)
    && result.deliveries!.every(row => row.status === 'sent' && Boolean(row.messageId || row.sentAt));
}

export function deliverySentTime(result: DeliveryClientResult): string {
  const at = result.deliveries?.find(row => row.sentAt)?.sentAt || result.updatedAt || result.createdAt;
  return at && Number.isFinite(Date.parse(at))
    ? new Date(at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
    : '此前';
}

export function deliveryClientError(error: unknown): string {
  return error instanceof Error && !['AbortError', 'TimeoutError', 'TypeError'].includes(error.name)
    ? error.message
    : '网络较慢，提交结果待确认；重试会核对同一任务，不会重复投递';
}

/** One candidate/job per intent: current/all/bulk and multiple tabs reuse the same ID. */
export async function createDeliveryTask(payload: DeliveryClientPayload): Promise<DeliveryClientTask> {
  if (!payload.fileUrl || !payload.target.trim() || payload.deliveries.length !== 1) {
    throw new Error('请确认简历附件、收件人和目标岗位');
  }
  if (payload.sourceSnapshot && payload.sourceSnapshot.column !== payload.sender) {
    throw new Error('人选所属人与发送账号不同，请重新选择人选');
  }
  const { sender, target, fileUrl, deliveries } = payload;
  const application = deliveries[0].application;
  // Property insertion order varies between entrypoints; it is not part of an intent.
  const normalizedDeliveries = [{ text: deliveries[0].text, fileName: deliveries[0].fileName,
    application: Object.fromEntries(Object.entries(application).sort(([a], [b]) => a.localeCompare(b))),
  }];
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({
    sender, target: target.trim(), fileUrl, deliveries: normalizedDeliveries,
  })));
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  const key = `recruit:delivery-intent:v1:${hash}`;
  const intent = readIntent(key) || { requestId: `client-${hash}`, createdAt: new Date().toISOString() };
  writeIntent(key, intent);
  intentKeyById.set(intent.requestId, key);
  return { ...payload, target: target.trim(), requestId: intent.requestId, retryIfFailed: true };
}

/** Called only after the user explicitly confirms another delivery of a sent intent. */
export async function renewDeliveryTasks(tasks: DeliveryClientTask[]): Promise<DeliveryClientTask[]> {
  return Promise.all(tasks.map(async task => {
    const key = intentKeyById.get(task.requestId);
    const previous = key ? readIntent(key) : undefined;
    if (!key || !previous) throw new Error('未找到原发送记录，请先核对发送状态');
    // Another tab already renewed this same confirmed send: reuse its next intent.
    if (previous.requestId !== task.requestId) {
      intentKeyById.set(previous.requestId, key);
      return { ...task, requestId: previous.requestId };
    }
    if (!previous.receipt || !isConfirmedSent(previous.receipt)) throw new Error('原任务尚未确认送达，请先核对状态，不可新建重复发送');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${task.requestId}:next`));
    const requestId = `client-${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
    // Deterministic successor prevents concurrent tabs from creating two new sends.
    const latest = readIntent(key);
    if (latest && latest.requestId !== task.requestId) {
      intentKeyById.set(latest.requestId, key);
      return { ...task, requestId: latest.requestId };
    }
    writeIntent(key, { requestId, createdAt: new Date().toISOString() }, true);
    intentKeyById.set(requestId, key);
    return { ...task, requestId };
  }));
}

/** Bounded submission; receipt failures never replace the original intent IDs. */
export async function submitDeliveryTasks(
  tasks: DeliveryClientTask[],
  onResult?: (result: DeliveryClientResult, index: number) => void,
): Promise<DeliveryClientResult[]> {
  if (!tasks.length || tasks.length > 10 || tasks.some(task => task.sender !== tasks[0].sender)) {
    throw new Error('一次最多发送 10 项，且必须属于同一个账号');
  }
  const results = new Map<string, DeliveryClientResult>();
  const remember = (row: DeliveryClientResult) => {
    const index = tasks.findIndex(task => task.requestId === row.id);
    if (index < 0 || !row.id) return;
    results.set(row.id, row);
    const key = intentKeyById.get(row.id);
    const intent = key ? readIntent(key) : undefined;
    if (key && intent?.requestId === row.id && isConfirmedSent(row)) writeIntent(key, { ...intent, receipt: row });
    // UI projection failures must never cause a successfully queued task to be replayed.
    try { onResult?.(row, index); } catch { /* The server receipt remains authoritative. */ }
  };
  const expired: DeliveryClientTask[] = [];
  for (const task of tasks) {
    const key = intentKeyById.get(task.requestId);
    const intent = key ? readIntent(key) : undefined;
    if (intent?.requestId !== task.requestId) continue;
    if (intent.receipt && isConfirmedSent(intent.receipt)) remember(intent.receipt);
    else if (Date.now() - Date.parse(intent.createdAt) > MAX_UNCONFIRMED_AGE_MS) expired.push(task);
  }
  if (expired.length) {
    const retryableExpiredIds = new Set<string>();
    try {
      const query = expired.map(task => `ids=${encodeURIComponent(task.requestId)}`).join('&');
      const receipt = await fetch(`/api/tg/send?receipt=1&${query}`, { cache: 'no-store', signal: AbortSignal.timeout(8_000) });
      const data = await receipt.json();
      if (receipt.ok && data.ok && Array.isArray(data.results)) {
        for (const row of data.results as DeliveryClientResult[]) {
          if (!row.id || !expired.some(task => task.requestId === row.id)) continue;
          if (row.status === 'failed' || row.status === 'partial_failed') retryableExpiredIds.add(row.id);
          else if (row.status) remember(row);
        }
      }
    } catch { /* Never recreate an expired send whose outcome is unknown. */ }
    expired.filter(task => !results.has(task.requestId) && !retryableExpiredIds.has(task.requestId)).forEach(task => remember({
      id: task.requestId, ok: false, unconfirmed: true,
      error: '这条旧发送已超过安全重试期，结果无法确认；请先核对推荐中心和 TG，不会自动重发',
    }));
  }
  let pending = tasks.filter(task => !results.has(task.requestId));
  for (let attempt = 0; attempt < 2 && pending.length; attempt += 1) {
    let definitiveError = '';
    try {
      const response = await fetch('/api/tg/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sender: tasks[0].sender, batch: pending }),
        signal: AbortSignal.timeout(20_000),
      });
      const data = await response.json();
      if (response.ok && data.ok && Array.isArray(data.results)) {
        data.results.forEach((row: DeliveryClientResult) => remember(row));
      } else {
        if (response.status < 500 && response.status !== 408 && response.status !== 429) {
          definitiveError = data.error || '发送信息有误，请核对后重试';
        }
        throw new Error(data.error || '发送任务暂未确认');
      }
    } catch {
      // A committed write may have lost its HTTP response; check only its receipts.
      try {
        const query = pending.map(task => `ids=${encodeURIComponent(task.requestId)}`).join('&');
        const receipt = await fetch(`/api/tg/send?receipt=1&${query}`, {
          cache: 'no-store', signal: AbortSignal.timeout(8_000),
        });
        const data = await receipt.json();
        if (receipt.ok && data.ok && Array.isArray(data.results)) {
          for (const row of data.results as DeliveryClientResult[]) {
            if (row.status && ['queued', 'sending', 'sent', 'failed', 'partial_failed'].includes(row.status)) remember(row);
          }
        }
      } catch { /* Leave unresolved IDs intact for a bounded retry. */ }
      if (definitiveError) {
        pending.filter(task => !results.has(task.requestId)).forEach(task => remember({
          id: task.requestId, ok: false, error: definitiveError,
        }));
      }
    }
    pending = pending.filter(task => !results.has(task.requestId));
  }
  pending.forEach(task => remember({ id: task.requestId, ok: false, unconfirmed: true,
    error: deliveryClientError(undefined),
  }));
  return tasks.map(task => results.get(task.requestId)!);
}
