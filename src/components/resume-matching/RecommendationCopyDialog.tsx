'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Copy, FileCheck2, FileText, Loader2, Send, Users, X } from 'lucide-react';
import { useEscapeClose } from '@/hooks/useEscapeClose';
import { cn } from '@/lib/utils';
import type { RepushColumnId, RepushItem } from '@/store/repush-store';
import { createDeliveryTask, submitDeliveryTasks, renewDeliveryTasks, deliverySentTime, deliveryClientError, type DeliveryClientTask, type DeliveryClientResult } from '@/lib/tg-delivery-client';

export interface RecommendationCopyItem {
  jdId: string;
  title: string;
  organization: string;
  department: string;
  contactPerson: string;
  candidateCode: string;
  candidateIdentityId: string;
  candidateName: string;
  contact: string;
  fileName: string;
  text: string;
}

export interface RecommendationDeliverySnapshot {
  ok?: boolean;
  id?: string;
  queued?: boolean;
  status?: 'queued' | 'sending' | 'sent' | 'failed' | 'partial_failed';
  sent?: number;
  total?: number;
  createdAt?: string;
  updatedAt?: string;
  applications?: Array<{
    index: number;
    applicationId: string;
    jdId: string;
  }>;
  records?: RepushItem[];
  deliveries?: Array<{
    index: number;
    status: 'pending' | 'sending' | 'sent' | 'failed';
    messageId?: string;
    sentAt?: string;
    error?: string;
  }>;
  error?: string;
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
  resumeFileName: string;
  resumeBlobUrl?: string;
  onResumeBlobReady?: (url: string) => void;
  validateBeforeSend?: (items: RecommendationCopyItem[]) => void;
  onDeliveryUpdate?: (
    items: RecommendationCopyItem[],
    delivery: RecommendationDeliverySnapshot,
    fileUrl: string,
  ) => void;
  onEditCandidateInfo: () => void;
  onClose: () => void;
}

const UPLOAD_TIMEOUT_MS = 45_000;
const SERVER_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function RecommendationCopyDialog({
  owner,
  items,
  initialJdId,
  resumeFile,
  resumeFileName,
  resumeBlobUrl,
  onResumeBlobReady,
  validateBeforeSend,
  onDeliveryUpdate,
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
  const [sentRequests, setSentRequests] = useState<Array<{ task: DeliveryClientTask; result: DeliveryClientResult; item: RecommendationCopyItem }>>([]);
  const submitLock = useRef(false);
  useEscapeClose(onClose, !sendingMode);

  useEffect(() => {
    setActiveJdId(initialJdId || items[0]?.jdId || '');
  }, [initialJdId, items]);

  useEffect(() => {
    setUploadedBlobUrl(resumeBlobUrl || '');
  }, [resumeBlobUrl, resumeFile]);

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

    // 小文件优先经服务端转存，避免部分网络环境下浏览器直连 Blob 长时间卡住。
    if (resumeFile.size <= SERVER_UPLOAD_MAX_BYTES) {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
      try {
        const formData = new FormData();
        formData.append('file', resumeFile);
        const response = await fetch('/api/talent/upload', {
          method: 'POST',
          body: formData,
          signal: controller.signal,
        });
        const data = await response.json().catch(() => ({})) as { url?: string; error?: string };
        if (!response.ok || !data.url) throw new Error(data.error || '服务端上传失败');
        setUploadedBlobUrl(data.url);
        onResumeBlobReady?.(data.url);
        return data.url;
      } catch {
        // 服务端通道失败时继续尝试 Blob 客户端直传。
      } finally {
        window.clearTimeout(timer);
      }
    }

    const { upload } = await import('@vercel/blob/client');
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
      try {
        const blob = await upload(`resumes/recommendations/${Date.now()}-${resumeFile.name}`, resumeFile, {
          access: 'public',
          handleUploadUrl: '/api/resume/blob-upload',
          contentType: resumeFile.type || 'application/octet-stream',
          abortSignal: controller.signal,
        });
        setUploadedBlobUrl(blob.url);
        onResumeBlobReady?.(blob.url);
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

  const sendRecommendations = async (deliveryItems: RecommendationCopyItem[], mode: 'current' | 'all', repeatSent = false) => {
    if (!recipient.trim() || sendingMode || submitLock.current) return;
    if (deliveryItems.length > 10) {
      setDeliveryNotice({ ok: false, text: '一次最多发送 10 个岗位，请减少选择后重试' });
      return;
    }
    submitLock.current = true;
    setSendingMode(mode);
    setSendingStep(uploadedBlobUrl ? 'queueing' : 'uploading');
    setDeliveryNotice(null);
    try {
      validateBeforeSend?.(deliveryItems);
      const fileUrl = await ensureResumeBlob();
      validateBeforeSend?.(deliveryItems);
      setSendingStep('queueing');
      const tasks = repeatSent ? await renewDeliveryTasks(sentRequests.map(row => row.task)) : await Promise.all(deliveryItems.map(item => createDeliveryTask({
        sender: owner,
        target: recipient.trim(),
        fileUrl,
        deliveries: [{
          text: item.text,
          fileName: item.fileName,
          application: {
            jdId: item.jdId,
            candidateCode: item.candidateCode,
            candidateIdentityId: item.candidateIdentityId,
            candidateName: item.candidateName,
            jdTitle: item.title,
            contact: item.contact,
            contactPerson: item.contactPerson,
            organization: item.organization,
            department: item.department,
            resumeFileName,
            source: 'intake' as const,
          },
        }],
      })));
      const results = await submitDeliveryTasks(tasks, (data, index) => {
        if (data.status) onDeliveryUpdate?.([deliveryItems[index]], data, fileUrl);
      });
      const accepted = results.filter(data => data.ok && ['queued', 'sending', 'sent'].includes(data.status || ''));
      const failure = results.find(data => !data.ok || !['queued', 'sending', 'sent'].includes(data.status || ''));
      const sent = accepted.filter(data => data.status === 'sent').length;
      const confirmed = results.flatMap((result, index) => result.status === 'sent'
        ? [{ task: tasks[index], result, item: deliveryItems[index] }] : []);
      setSentRequests(confirmed);
      setDeliveryNotice({ ok: !failure, text: failure
        ? `已确认 ${accepted.length}/${results.length} 项。${failure.error || '部分任务未完成，重试只处理未发送项'}`
        : sent === results.length ? `这 ${sent} 份推荐已于 ${deliverySentTime(confirmed[0].result)} 送达；如需再次发送请单独确认`
          : `已加入发送队列 ${accepted.length} 项，可关闭窗口；推荐中心将显示实际送达状态` });
    } catch (error) {
      setDeliveryNotice({ ok: false, text: deliveryClientError(error) });
    } finally {
      submitLock.current = false;
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
        if (event.target === event.currentTarget && !sendingMode) onClose();
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
              disabled={!!sendingMode}
              className="h-8 rounded-lg border border-slate-200 px-3 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50"
            >
              修改候选人信息
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={!!sendingMode}
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
                    disabled={!!sendingMode}
                    onChange={(event) => { setRecipient(event.target.value); setSentRequests([]); }}
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
              {sentRequests.length > 0 && <button type="button" disabled={!!sendingMode}
                onClick={() => {
                  if (window.confirm(`这 ${sentRequests.length} 项推荐此前已送达。确定再次发送相同文案和附件吗？`)) {
                    void sendRecommendations(sentRequests.map(row => row.item), 'all', true);
                  }
                }} className="mt-2 text-xs text-indigo-600 underline disabled:opacity-40">确认再次发送已送达项（{sentRequests.length}）</button>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
