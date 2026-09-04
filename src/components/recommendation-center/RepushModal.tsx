'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, Copy, FileText, Loader2, Repeat, Search, Send, Users, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { hasCategory, type JD, type JDCategory } from '@/types/jd';
import type { RepushItem } from '@/store/repush-store';
import { displayName } from '@/lib/repush-format';
import { useEscapeClose } from '@/hooks/useEscapeClose';
import { buildRecommendationText, recommendationOrganization } from '@/lib/recommendation-copy';

export interface RepushArgs {
  jdTitle: string;
  organization: string;
  department: string;
  contactPerson: string;
  recommendationText: string;
}

interface TgDialogOption {
  id: string;
  target: string;
  title: string;
  username: string;
  type: string;
}

interface RepushModalProps {
  item: RepushItem;
  existingItems: RepushItem[];
  jds: JD[];
  initialCategory?: JDCategory;
  excludeRecommended?: boolean;
  resultLimit?: number;
  onClose: () => void;
  onConfirm: (args: RepushArgs) => void;
}

function clean(value?: string): string {
  return String(value || '').trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readLabeledValue(text: string, labels: string[]): string {
  for (const label of labels) {
    const match = text.match(new RegExp(`${escapeRegExp(label)}[^\\n:：]*[:：][ \\t\\u3000]*([^\\n]*)`, 'i'));
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return '';
}

function targetKey(title?: string, organization?: string, department?: string): string {
  return [title, organization, department].map((value) => clean(value).toLowerCase()).join('|');
}

function isSameCandidate(a: RepushItem, b: RepushItem): boolean {
  if (a.column !== b.column) return false;
  if (a.candidateCode && b.candidateCode) {
    return clean(a.candidateCode).toLowerCase() === clean(b.candidateCode).toLowerCase();
  }
  return clean(a.candidateName || displayName(a)).toLowerCase()
    === clean(b.candidateName || displayName(b)).toLowerCase();
}

function candidateName(item: RepushItem): string {
  return clean(
    item.candidateName
    || readLabeledValue(item.rawText || '', ['候选人姓名（英文名）', '候选人姓名', '姓名'])
    || displayName(item).split('-')[0],
  );
}

function buildRepushCopy(item: RepushItem, jd: JD): string {
  const rawText = item.rawText || '';
  return buildRecommendationText(item.column, jd, {
    candidateCode: clean(item.candidateCode),
    candidateName: candidateName(item),
    workYears: readLabeledValue(rawText, ['工作年限', '工作经验年限', '工作经验']),
    currentSalary: readLabeledValue(rawText, ['当前薪资', '目前薪资', '现薪资', '现薪']),
    expectedSalary: readLabeledValue(rawText, ['期望薪资', '薪资期望', '期望月薪']),
    location: readLabeledValue(rawText, ['目前所在地', '当前所在地', '现居地', '所在地', '现居']),
    arrivalTime: readLabeledValue(rawText, ['预计可到岗时间', '可到岗时间', '到岗时间', '最快到岗时间']),
    contact: clean(item.contact) || readLabeledValue(rawText, ['候选人联系方式', '联系方式']),
    resumeSource: readLabeledValue(rawText, ['简历来源']) || '简历储备',
  });
}

function safeFilePart(value: string): string {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim();
}

function buildDeliveryFileName(item: RepushItem, jd: JD): string {
  const sourceName = item.resumeFileName || item.fileName;
  const extension = sourceName.match(/\.(pdf|docx?|jpe?g|png|webp|gif)$/i)?.[0].toLowerCase() || '.pdf';
  return `${[candidateName(item), jd.title].map(safeFilePart).filter(Boolean).join('-')}${extension}`;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** 在推荐中心选择具体 JD，生成文案，并可直接把文案与原简历发送到 TG。 */
export function RepushModal({
  item,
  existingItems,
  jds,
  initialCategory,
  excludeRecommended = false,
  resultLimit = 12,
  onClose,
  onConfirm,
}: RepushModalProps) {
  const [query, setQuery] = useState('');
  const [selectedJdId, setSelectedJdId] = useState('');
  const [copied, setCopied] = useState(false);
  const [recipient, setRecipient] = useState('@ojisamer');
  const [tgDialogs, setTgDialogs] = useState<TgDialogOption[]>([]);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  useEscapeClose(onClose);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/tg/dialogs?sender=${item.column}`)
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok) throw new Error(data.error || '读取 TG 会话失败');
        if (!cancelled) setTgDialogs(Array.isArray(data.items) ? data.items : []);
      })
      .catch(() => {
        if (!cancelled) setTgDialogs([]);
      });
    return () => { cancelled = true; };
  }, [item.column]);

  const recommendedTargets = useMemo(() => {
    const targets = new Set<string>();
    for (const existing of existingItems) {
      if (isSameCandidate(item, existing)) {
        targets.add(targetKey(existing.jdTitle, existing.organization, existing.department));
      }
    }
    return targets;
  }, [existingItems, item]);

  const matchingJds = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return jds
      .filter((jd) => jd.status !== 'paused')
      .filter((jd) => !initialCategory || hasCategory(jd, initialCategory))
      .filter((jd) => !excludeRecommended || !recommendedTargets.has(targetKey(jd.title, recommendationOrganization(jd), jd.department)))
      .filter((jd) => {
        if (!keyword) return true;
        return [jd.title, jd.organization, jd.serviceUnit, jd.department, jd.odc]
          .some((value) => clean(value).toLowerCase().includes(keyword));
      })
      .sort((a, b) => {
        const aUsed = recommendedTargets.has(targetKey(a.title, recommendationOrganization(a), a.department));
        const bUsed = recommendedTargets.has(targetKey(b.title, recommendationOrganization(b), b.department));
        if (aUsed !== bUsed) return aUsed ? 1 : -1;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      })
      .slice(0, resultLimit);
  }, [excludeRecommended, initialCategory, jds, query, recommendedTargets, resultLimit]);

  useEffect(() => {
    if (matchingJds.length === 0) {
      if (selectedJdId) setSelectedJdId('');
      return;
    }
    if (!matchingJds.some((jd) => jd.id === selectedJdId)) {
      setSelectedJdId(matchingJds[0].id);
    }
  }, [matchingJds, selectedJdId]);

  const selectedJd = jds.find((jd) => jd.id === selectedJdId) || null;
  const recommendationText = selectedJd ? buildRepushCopy(item, selectedJd) : '';
  const hasResume = Boolean(item.resumeUrl);

  const handleCopy = async () => {
    if (!recommendationText) return;
    await navigator.clipboard.writeText(recommendationText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const confirmRepush = () => {
    if (!selectedJd) return;
    onConfirm({
      jdTitle: selectedJd.title,
      organization: recommendationOrganization(selectedJd),
      department: clean(selectedJd.department),
      contactPerson: clean(selectedJd.odc),
      recommendationText,
    });
    onClose();
  };

  const enqueueDelivery = async (body: object) => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 20_000);
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

  const handleSendAndRepush = async () => {
    if (!selectedJd || !item.resumeUrl || !recipient.trim() || sending) return;
    setSending(true);
    setSendError('');
    try {
      const requestId = typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      await enqueueDelivery({
        requestId,
        sender: item.column,
        target: recipient.trim(),
        fileUrl: item.resumeUrl,
        deliveries: [{
          text: recommendationText,
          fileName: buildDeliveryFileName(item, selectedJd),
        }],
      });
      confirmRepush();
    } catch (error) {
      setSendError((error as Error).message || 'TG 发送失败');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 p-4" role="dialog" aria-modal="true" aria-label="指定岗位复推">
      <div className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h3 className="flex items-center gap-2 text-base font-semibold text-slate-900">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-50 text-violet-600"><Repeat className="h-4 w-4" /></span>
              指定岗位复推
            </h3>
            <p className="mt-1 pl-10 text-xs text-slate-400">
              {displayName(item)} · 选择具体岗位后生成推荐文案，可连同原简历直接发送
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={sending} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:cursor-not-allowed" title="关闭"><X className="h-5 w-5" /></button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[360px_minmax(0,1fr)]">
          <div className="flex min-h-[360px] flex-col border-b border-slate-100 bg-slate-50/60 p-4 md:min-h-0 md:border-b-0 md:border-r">
            <label className="mb-2 text-xs font-medium text-slate-500">搜索目标岗位、编制或部门</label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="如 Go、技术中心、紫宸星宇"
                className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
              />
            </div>
            <div className="mt-3 min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
              {matchingJds.map((jd) => {
                const organization = recommendationOrganization(jd);
                const alreadyRecommended = recommendedTargets.has(targetKey(jd.title, organization, jd.department));
                const active = selectedJdId === jd.id;
                return (
                  <button
                    type="button"
                    key={jd.id}
                    onClick={() => { setSelectedJdId(jd.id); setCopied(false); setSendError(''); }}
                    className={cn(
                      'w-full rounded-lg border px-3 py-2.5 text-left transition-colors',
                      active ? 'border-violet-300 bg-white shadow-sm ring-2 ring-violet-100' : 'border-transparent bg-white/70 hover:border-slate-200 hover:bg-white',
                    )}
                  >
                    <span className="flex items-start justify-between gap-2">
                      <span className="line-clamp-2 text-sm font-medium text-slate-800">{jd.title}</span>
                      {alreadyRecommended && <span className="shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">已推荐</span>}
                    </span>
                    <span className="mt-1 block truncate text-xs text-slate-400">{organization || '未填写编制/单位'}{jd.department ? ` · ${jd.department}` : ''}</span>
                    <span className="mt-1 block text-[11px] text-emerald-600">{jd.salaryText || `${jd.salaryRange.min || 0}-${jd.salaryRange.max || 0}${jd.salaryRange.currency || ''}`}</span>
                  </button>
                );
              })}
              {matchingJds.length === 0 && <p className="py-10 text-center text-sm text-slate-400">没有找到相关岗位</p>}
            </div>
          </div>

          <div className="flex min-h-[380px] flex-col p-5 md:min-h-0">
            {selectedJd ? (
              <>
                <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-xs font-medium text-violet-600"><FileText className="h-4 w-4" />已生成推荐文案</p>
                    <h4 className="mt-1 truncate text-base font-semibold text-slate-900">{selectedJd.title}</h4>
                    <p className="mt-1 text-xs text-slate-400">{recommendationOrganization(selectedJd) || '未填写编制/单位'}{selectedJd.department ? ` · ${selectedJd.department}` : ''}</p>
                  </div>
                  <button type="button" onClick={handleCopy} className={cn('inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium', copied ? 'bg-emerald-50 text-emerald-600' : 'bg-violet-50 text-violet-600 hover:bg-violet-100')}>
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copied ? '已复制' : '复制文案'}
                  </button>
                </div>
                <textarea readOnly value={recommendationText} onFocus={(event) => event.currentTarget.select()} className="min-h-[280px] flex-1 resize-none rounded-lg border border-slate-200 bg-slate-50/60 p-4 text-sm leading-7 text-slate-700 outline-none focus:border-violet-300 focus:bg-white focus:ring-2 focus:ring-violet-100" />
              </>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center text-center text-slate-400">
                <FileText className="mb-3 h-9 w-9 text-slate-300" />
                <p className="text-sm font-medium text-slate-500">先从左侧选择一个具体岗位</p>
                <p className="mt-1 text-xs">系统会自动带入目标编制、服务单位和对接 BP</p>
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-slate-100 px-5 py-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="min-w-0 flex-1">
              <label htmlFor="repush-tg-recipient" className="mb-1.5 block text-xs font-medium text-slate-500">发送给</label>
              <div className="relative">
                <Users className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  id="repush-tg-recipient"
                  list="repush-tg-dialogs"
                  value={recipient}
                  onChange={(event) => { setRecipient(event.target.value); setSendError(''); }}
                  placeholder="@ojisamer"
                  className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
                />
                <datalist id="repush-tg-dialogs">
                  {tgDialogs.map((dialog) => <option key={dialog.id} value={dialog.target}>{dialog.title || dialog.username}</option>)}
                </datalist>
              </div>
              {sendError ? (
                <p className="mt-1.5 text-xs text-red-500">{sendError}</p>
              ) : !hasResume ? (
                <p className="mt-1.5 text-xs text-amber-600">这条历史记录没有可发送的原简历文件，可复制文案或仅确认复推。</p>
              ) : (
                <p className="mt-1.5 text-xs text-slate-400">将发送文案和重命名后的原简历；默认收件人是 @ojisamer。</p>
              )}
            </div>
            <div className="flex shrink-0 items-center justify-end gap-2 self-end">
              <button type="button" onClick={onClose} disabled={sending} className="h-10 rounded-lg px-3 text-sm font-medium text-slate-500 hover:bg-slate-100 disabled:cursor-not-allowed">取消</button>
              <button type="button" onClick={confirmRepush} disabled={!selectedJd || sending} className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300">
                <Repeat className="h-4 w-4" />仅确认复推
              </button>
              <button type="button" onClick={handleSendAndRepush} disabled={!selectedJd || !hasResume || !recipient.trim() || sending} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-violet-600 px-4 text-sm font-medium text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-slate-200">
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {sending ? '正在发送' : '发送并复推'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
