'use client';

import { useEffect, useState } from 'react';
import { Check, Copy, FileCheck2, FileText, Loader2, Send, Users, X } from 'lucide-react';
import { useEscapeClose } from '@/hooks/useEscapeClose';
import { cn } from '@/lib/utils';
import type { RepushColumnId } from '@/store/repush-store';

export interface RecommendationCopyItem {
  jdId: string;
  title: string;
  organization: string;
  contactPerson: string;
  fileName: string;
  text: string;
}

interface TgDialogOption {
  id: string;
  target: string;
  title: string;
  username: string;
  type: string;
}

interface RecommendationCopyDialogProps {
  owner: RepushColumnId;
  items: RecommendationCopyItem[];
  initialJdId?: string;
  resumeFile: File | null;
  resumeBlobUrl?: string;
  onEditCandidateInfo: () => void;
  onClose: () => void;
}

const UPLOAD_TIMEOUT_MS = 30_000;
const SEND_TIMEOUT_MS = 20_000;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function RecommendationCopyDialog({
  owner,
  items,
  initialJdId,
  resumeFile,
  resumeBlobUrl,
  onEditCandidateInfo,
  onClose,
}: RecommendationCopyDialogProps) {
  const [activeJdId, setActiveJdId] = useState(initialJdId || items[0]?.jdId || '');
  const [copiedJdId, setCopiedJdId] = useState('');
  const [tgDialogs, setTgDialogs] = useState<TgDialogOption[]>([]);
  const [recipient, setRecipient] = useState('@ojisamer');
  const [isLoadingDialogs, setIsLoadingDialogs] = useState(true);
  const [uploadedBlobUrl, setUploadedBlobUrl] = useState(resumeBlobUrl || '');
  const [sendingMode, setSendingMode] = useState<'current' | 'all' | ''>('');
  const [sendingStep, setSendingStep] = useState<'uploading' | 'queueing' | ''>('');
  const [deliveryNotice, setDeliveryNotice] = useState<{ ok: boolean; text: string } | null>(null);
  useEscapeClose(onClose);

  useEffect(() => {
    setActiveJdId(initialJdId || items[0]?.jdId || '');
  }, [initialJdId, items]);

  const activeItem = items.find((item) => item.jdId === activeJdId) || items[0];

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/tg/dialogs?sender=${owner}`)
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok) throw new Error(data.error || '读取 TG 会话失败');
        if (!cancelled) setTgDialogs(Array.isArray(data.items) ? data.items : []);
      })
      .catch(() => {
        if (!cancelled) setTgDialogs([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingDialogs(false);
      });
    return () => { cancelled = true; };
  }, [owner]);

  useEffect(() => {
    if (recipient || !activeItem) return;
    const handle = activeItem.contactPerson.match(/@[A-Za-z0-9_]{2,}/)?.[0];
    if (handle) setRecipient(handle);
  }, [activeItem, recipient]);

  if (!activeItem) return null;
  const hasResume = Boolean(resumeFile || uploadedBlobUrl);

  const copyCurrent = async () => {
    try {
      await navigator.clipboard.writeText(activeItem.text);
      setCopiedJdId(activeItem.jdId);
      setTimeout(() => setCopiedJdId(''), 1600);
    } catch {
      setCopiedJdId('');
    }
  };

  const ensureResumeBlob = async (): Promise<string> => {
    if (uploadedBlobUrl) return uploadedBlobUrl;
    if (!resumeFile) throw new Error('请先返回上一步上传简历');
    const { upload } = await import('@vercel/blob/client');
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
      try {
        const blob = await upload(resumeFile.name, resumeFile, {
          access: 'public',
          handleUploadUrl: '/api/resume/blob-upload',
          contentType: resumeFile.type || 'application/octet-stream',
          abortSignal: controller.signal,
        });
        setUploadedBlobUrl(blob.url);
        return blob.url;
      } catch (error) {
        lastError = error;
        if (attempt === 0) await wait(800);
      } finally {
        window.clearTimeout(timer);
      }
    }
    throw new Error(lastError instanceof Error && lastError.name !== 'AbortError'
      ? `简历上传失败：${lastError.message}`
      : '简历上传超时，请检查网络后重试');
  };

  const enqueueDelivery = async (body: object) => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
      try {
        const response = await fetch('/api/tg/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok) throw new Error(data.error || 'TG 发送失败');
        return data;
      } catch (error) {
        lastError = error;
        if (attempt === 0) await wait(800);
      } finally {
        window.clearTimeout(timer);
      }
    }
    throw new Error(lastError instanceof Error && lastError.name !== 'AbortError'
      ? lastError.message
      : '加入发送队列超时，请稍后重试');
  };

  const followDelivery = async (id: string, expected: number) => {
    for (let attempt = 0; attempt < 180; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      try {
        const response = await fetch(`/api/tg/send?id=${encodeURIComponent(id)}`);
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok) continue;
        if (data.status === 'sent') {
          setDeliveryNotice({ ok: true, text: `已发送 ${data.sent || expected} 份推荐` });
          return;
        }
        if (data.status === 'failed') {
          setDeliveryNotice({ ok: false, text: data.error || 'TG 发送失败' });
          return;
        }
      } catch {
        // 工作站队列稍后仍会继续处理，短暂查询失败不覆盖当前提示。
      }
    }
    setDeliveryNotice({ ok: false, text: '发送仍在后台处理中，请勿重复点击；完成后可在 TG 中确认' });
  };

  const sendRecommendations = async (deliveryItems: RecommendationCopyItem[], mode: 'current' | 'all') => {
    if (!recipient.trim() || sendingMode) return;
    setSendingMode(mode);
    setSendingStep(uploadedBlobUrl ? 'queueing' : 'uploading');
    setDeliveryNotice(null);
    try {
      const fileUrl = await ensureResumeBlob();
      setSendingStep('queueing');
      const requestId = typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const data = await enqueueDelivery({
        requestId,
        sender: owner,
        target: recipient.trim(),
        fileUrl,
        deliveries: deliveryItems.map((item) => ({ text: item.text, fileName: item.fileName })),
      });
      if (data.queued && data.id) {
        setDeliveryNotice({ ok: true, text: '正在发送，通常几秒内完成' });
        void followDelivery(data.id, deliveryItems.length);
      } else {
        setDeliveryNotice({ ok: true, text: `已发送 ${data.sent || deliveryItems.length} 份推荐` });
      }
    } catch (error) {
      setDeliveryNotice({ ok: false, text: (error as Error).message || 'TG 发送失败' });
    } finally {
      setSendingMode('');
      setSendingStep('');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="岗位推荐文案"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[86vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h3 className="flex items-center gap-2 text-base font-semibold text-slate-900">
              <FileText className="h-5 w-5 text-indigo-500" />
              推荐文案
              <span className="rounded-md bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-600">
                {items.length} 个岗位
              </span>
            </h3>
            <p className="mt-1 text-xs text-slate-400">每个岗位独立一份，可复制，也可连同改名后的简历发送到 TG。</p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onEditCandidateInfo}
              className="h-8 rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50"
            >
              修改候选人信息
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
              aria-label="关闭"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto md:grid-cols-[240px_minmax(0,1fr)] md:overflow-hidden">
          <div className="border-b border-slate-100 bg-slate-50/70 p-3 md:overflow-y-auto md:border-b-0 md:border-r">
            <p className="mb-2 px-2 text-xs font-medium text-slate-400">已生成岗位</p>
            <div className="flex gap-2 overflow-x-auto pb-1 md:block md:space-y-1 md:overflow-visible md:pb-0">
              {items.map((item) => (
                <button
                  type="button"
                  key={item.jdId}
                  onClick={() => setActiveJdId(item.jdId)}
                  className={cn(
                    'min-w-[210px] rounded-lg border px-3 py-2.5 text-left transition-colors md:min-w-0 md:w-full',
                    activeItem.jdId === item.jdId
                      ? 'border-indigo-200 bg-white text-slate-900 shadow-sm'
                      : 'border-transparent text-slate-600 hover:bg-white',
                  )}
                >
                  <span className="block truncate text-sm font-medium">{item.title}</span>
                  <span className="mt-1 block truncate text-xs text-slate-400">{item.organization || '未填写服务单位'}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex min-h-0 flex-col p-5">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h4 className="truncate text-base font-semibold text-slate-900">{activeItem.title}</h4>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
                  <span>服务单位：{activeItem.organization || '未填写'}</span>
                  <span>对接 BP：{activeItem.contactPerson || '未填写'}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={copyCurrent}
                className={cn(
                  'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3.5 text-sm font-medium transition-colors',
                  copiedJdId === activeItem.jdId
                    ? 'bg-emerald-50 text-emerald-600'
                    : 'bg-indigo-600 text-white hover:bg-indigo-700',
                )}
              >
                {copiedJdId === activeItem.jdId
                  ? <><Check className="h-4 w-4" />已复制</>
                  : <><Copy className="h-4 w-4" />复制当前文案</>}
              </button>
            </div>
            <textarea
              readOnly
              value={activeItem.text}
              onFocus={(event) => event.currentTarget.select()}
              className="min-h-[260px] flex-1 resize-none rounded-lg border border-slate-200 bg-slate-50/60 p-4 text-sm leading-7 text-slate-700 outline-none focus:border-indigo-300 focus:bg-white focus:ring-2 focus:ring-indigo-100 md:min-h-[300px]"
            />

            <div className="mt-4 border-t border-slate-100 pt-4">
              <div className="mb-3 flex min-w-0 items-center gap-2 text-xs text-slate-500">
                <FileCheck2 className="h-4 w-4 shrink-0 text-emerald-500" />
                <span className="shrink-0">发送文件：</span>
                <span className="truncate font-medium text-slate-700" title={activeItem.fileName}>{activeItem.fileName}</span>
                {!resumeFile && !uploadedBlobUrl && <span className="shrink-0 text-amber-500">尚未上传简历</span>}
              </div>

              <div className="flex flex-col gap-2 lg:flex-row">
                <div className="relative min-w-0 flex-1">
                  <Users className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    list="tg-recommendation-dialogs"
                    value={recipient}
                    onChange={(event) => setRecipient(event.target.value)}
                    placeholder={isLoadingDialogs ? '正在读取 TG 联系人和群组...' : '选择或输入 @用户名 / 群组 ID'}
                    className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-700 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                  />
                  <datalist id="tg-recommendation-dialogs">
                    {tgDialogs.map((dialog) => (
                      <option key={dialog.id} value={dialog.target}>{dialog.type} · {dialog.title}</option>
                    ))}
                  </datalist>
                </div>
                <button
                  type="button"
                  onClick={() => sendRecommendations([activeItem], 'current')}
                  disabled={!recipient.trim() || !hasResume || !!sendingMode}
                  className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-indigo-200 px-3.5 text-sm font-medium text-indigo-600 transition-colors hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {sendingMode === 'current' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {sendingMode === 'current' ? (sendingStep === 'uploading' ? '上传中' : '发送中') : '发送当前'}
                </button>
                {items.length > 1 && (
                  <button
                    type="button"
                    onClick={() => sendRecommendations(items, 'all')}
                    disabled={!recipient.trim() || !hasResume || !!sendingMode}
                    className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {sendingMode === 'all' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    {sendingMode === 'all' ? (sendingStep === 'uploading' ? '上传中' : '发送中') : `全部发送（${items.length}）`}
                  </button>
                )}
              </div>
              {deliveryNotice && (
                <p className={cn('mt-2 text-xs', deliveryNotice.ok ? 'text-emerald-600' : 'text-red-500')}>
                  {deliveryNotice.text}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
