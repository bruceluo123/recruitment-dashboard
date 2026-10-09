'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarCheck, Check, CircleX, Clock3, FileText, Loader2, Repeat2, Search, Send, Users, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { recentlyAddedJds } from '@/lib/jd-recent';
import { recommendationOrganization } from '@/lib/recommendation-copy';
import { useEscapeClose } from '@/hooks/useEscapeClose';
import type { JD } from '@/types/jd';
import type { RepushColumnId, RepushItem } from '@/store/repush-store';
import { buildDeliveryFileName, buildRepushCopy } from './RepushModal';
import { createDeliveryTask, submitDeliveryTasks, renewDeliveryTasks, deliverySentTime, deliveryClientError, type DeliveryClientTask, type DeliveryClientResult } from '@/lib/tg-delivery-client';

export interface BulkRepushCandidate {
  key: string;
  candidateCode: string;
  candidateName: string;
  talentId?: string;
  hasResumeText?: boolean;
  hasInterview?: boolean;
  interviewFailed?: boolean;
  item: RepushItem;
}

interface DeliveryStatusResponse {
  ok?: boolean;
  id?: string;
  status?: 'queued' | 'sending' | 'sent' | 'failed' | 'partial_failed';
  sent?: number;
  total?: number;
  records?: RepushItem[];
  error?: string;
  unconfirmed?: boolean;
}

type CandidateSendStatus = 'idle' | 'queued' | 'sending' | 'sent' | 'failed' | 'unconfirmed';

interface CandidateSendState {
  status: CandidateSendStatus;
  error?: string;
}

interface BulkRepushModalProps {
  owner: RepushColumnId;
  candidateOptions: BulkRepushCandidate[];
  jds: JD[];
  isAlreadyRecommended: (candidate: BulkRepushCandidate, jd: JD) => boolean;
  onRecords: (records: RepushItem[]) => void;
  onClose: () => void;
}

interface TgDialogOption {
  id: string;
  target: string;
  title: string;
  username: string;
}

const SHANGHAI_DAY_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
});
function formatLastRecommendedAt(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '时间待确认';
  const dayKey = (target: Date) => {
    const parts = SHANGHAI_DAY_FORMATTER.formatToParts(target);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day));
  };
  const days = Math.max(0, Math.round((dayKey(new Date()) - dayKey(date)) / 86_400_000));
  return `${days} 天前`;
}

function sendStatusMeta(status: CandidateSendStatus) {
  if (status === 'unconfirmed') return { label: '待确认', className: 'bg-amber-50 text-amber-700' };
  if (status === 'sent') return { label: '已发送', className: 'bg-emerald-50 text-emerald-700' };
  if (status === 'failed') return { label: '发送失败', className: 'bg-rose-50 text-rose-700' };
  if (status === 'sending') return { label: '发送中', className: 'bg-blue-50 text-blue-700' };
  if (status === 'queued') return { label: '排队中', className: 'bg-violet-50 text-violet-700' };
  return { label: '待发送', className: 'bg-slate-100 text-slate-500' };
}

function searchWords(query: string): string[] {
  return query.toLowerCase().split(/[\s+＋]+/).map((word) => word.trim()).filter(Boolean);
}

function wordPosition(text: string, word: string): number {
  if (word === 'go' || word === 'golang') {
    const match = /(^|[^a-z0-9])(?:golang|go)(?=$|[^a-z0-9])/i.exec(text);
    return match ? match.index + match[1].length : -1;
  }
  return text.toLowerCase().indexOf(word);
}

function resumeExcerpt(text: string, words: string[]): string[] {
  const excerpts: string[] = [];
  for (const word of words) {
    const position = wordPosition(text, word);
    if (position < 0) continue;
    const excerpt = text.slice(Math.max(0, position - 45), position + 90).replace(/\s+/g, ' ').trim();
    if (!excerpts.some((existing) => existing === excerpt)) excerpts.push(excerpt);
  }
  return excerpts.slice(0, 3);
}

export function BulkRepushModal({
  owner,
  candidateOptions,
  jds,
  isAlreadyRecommended,
  onRecords,
  onClose,
}: BulkRepushModalProps) {
  const [availableCandidates] = useState(() => candidateOptions);
  const [checkAlreadyRecommended] = useState(() => isAlreadyRecommended);
  const [candidateQuery, setCandidateQuery] = useState('');
  const [jobQuery, setJobQuery] = useState('');
  const [selectedCandidateKeys, setSelectedCandidateKeys] = useState<string[]>([]);
  const [selectedJdId, setSelectedJdId] = useState('');
  const [recipient, setRecipient] = useState('@ojisamer');
  const [tgDialogs, setTgDialogs] = useState<TgDialogOption[]>([]);
  const [sendStates, setSendStates] = useState<Record<string, CandidateSendState>>({});
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [sentRequests, setSentRequests] = useState<Array<{ task: DeliveryClientTask; result: DeliveryClientResult; candidate: BulkRepushCandidate }>>([]);
  const [resumeTextByTalentId, setResumeTextByTalentId] = useState<Record<string, string>>({});
  const [loadingResumes, setLoadingResumes] = useState(false);
  const [resumeTextsLoaded, setResumeTextsLoaded] = useState(false);
  const [resumeLoadError, setResumeLoadError] = useState('');
  const [resumeLoadVersion, setResumeLoadVersion] = useState(0);
  const [resumeLoadAction, setResumeLoadAction] = useState<'read' | 'scan'>('read');
  const [resumeProgress, setResumeProgress] = useState({ done: 0, total: 0 });
  const [visibleCandidateCount, setVisibleCandidateCount] = useState(50);
  const submitLock = useRef(false);
  useEscapeClose(onClose, !sending);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/tg/dialogs?sender=${owner}`)
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok) throw new Error(data.error || '读取 TG 会话失败');
        if (!cancelled) setTgDialogs(Array.isArray(data.items) ? data.items : []);
      })
      .catch(() => { if (!cancelled) setTgDialogs([]); });
    return () => { cancelled = true; };
  }, [owner]);

  useEffect(() => {
    setSendStates({});
    setError('');
  }, [selectedJdId]);

  const matchingJds = useMemo(() => {
    const keyword = jobQuery.trim().toLowerCase();
    return jds
      .filter((jd) => jd.status !== 'paused')
      .filter((jd) => !keyword || [jd.title, jd.organization, jd.serviceUnit, jd.department, jd.odc]
        .some((value) => String(value || '').toLowerCase().includes(keyword)))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 30);
  }, [jds, jobQuery]);
  const newJdIds = useMemo(() => new Set(recentlyAddedJds(jds).map((jd) => jd.id)), [jds]);

  const selectedJd = jds.find((jd) => jd.id === selectedJdId && jd.status !== 'paused') || null;

  // Read saved resume text on entry; scan missing attachments only when explicitly requested.
  useEffect(() => {
    const controller = new AbortController();
    const resumeId = (candidate: BulkRepushCandidate) => candidate.talentId || `recommendation:${candidate.key}`;
    const byId = new Map(availableCandidates.map((candidate) => [resumeId(candidate), candidate]));
    const ids = Array.from(byId.keys());
    const load = async () => {
      setLoadingResumes(ids.length > 0);
      setResumeLoadError('');
      setResumeProgress({ done: 0, total: 0 });
      try {
        const batches = Array.from({ length: Math.ceil(ids.length / 25) }, (_, index) => ids.slice(index * 25, index * 25 + 25));
        const stored: Array<{ id: string; text: string }> = [];
        for (const batch of batches) {
          let items: Array<{ id: string; text: string }> | undefined;
          for (let attempt = 0; attempt < 2 && !items; attempt++) {
            const response = await fetch('/api/talent/text', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ids: batch }), cache: 'no-store', signal: controller.signal,
            });
            const data = await response.json().catch(() => ({})) as { items?: Array<{ id: string; text: string }> };
            if (response.ok && Array.isArray(data.items)) items = data.items;
          }
          if (!items) throw new Error('读取简历失败');
          stored.push(...items);
        }
        if (controller.signal.aborted) return;
        const loaded = Object.fromEntries(stored.filter((item) => item.id && item.text).map((item) => [item.id, item.text]));
        setResumeTextByTalentId(loaded);
        setResumeTextsLoaded(true);
        const missing = ids.filter((id) => !loaded[id] && byId.get(id)?.item.resumeUrl);
        if (resumeLoadAction === 'read') return;
        setResumeProgress({ done: 0, total: missing.length });
        let cursor = 0;
        let failed = ids.length - Object.keys(loaded).length - missing.length;
        const failureReasons = new Set<string>();
        await Promise.all(Array.from({ length: Math.min(3, missing.length) }, async () => {
          while (cursor < missing.length && !controller.signal.aborted) {
            const id = missing[cursor++];
            const source = byId.get(id)!.item;
            try {
              const scan = await fetch('/api/talent/scan', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
                body: JSON.stringify({ id, url: source.resumeUrl, fileName: source.resumeFileName || source.fileName }),
              });
              if (!scan.ok) {
                const result = await scan.json().catch(() => ({})) as { error?: string };
                throw new Error(result.error || '提取失败');
              }
              const response = await fetch(`/api/talent/text?id=${encodeURIComponent(id)}`, { signal: controller.signal });
              const data = await response.json() as { text?: string };
              if (!response.ok || !data.text) throw new Error('正文读取失败');
              if (!controller.signal.aborted) setResumeTextByTalentId((current) => ({ ...current, [id]: data.text! }));
            } catch (error) {
              if (!controller.signal.aborted) {
                failed++;
                failureReasons.add(error instanceof Error ? error.message : '提取失败');
              }
            } finally {
              if (!controller.signal.aborted) setResumeProgress((current) => ({ ...current, done: current.done + 1 }));
            }
          }
        }));
        if (failed && !controller.signal.aborted) setResumeLoadError(`${failed} 位人选仍未补全。${Array.from(failureReasons).slice(0, 2).join('；')}`);
      } catch {
        if (!controller.signal.aborted) {
          setResumeTextsLoaded(false);
          setResumeLoadError('已保存的简历正文读取失败，暂不能判断哪些需要补全。');
        }
      } finally {
        if (!controller.signal.aborted) setLoadingResumes(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [availableCandidates, resumeLoadAction, resumeLoadVersion]);

  const pendingResumeCount = resumeTextsLoaded
    ? availableCandidates.filter((candidate) => !resumeTextByTalentId[candidate.talentId || `recommendation:${candidate.key}`]).length
    : 0;

  useEffect(() => { setVisibleCandidateCount(50); }, [candidateQuery]);

  const filteredCandidates = useMemo(() => {
    const words = searchWords(candidateQuery);
    return availableCandidates.filter((candidate) => {
      if (!words.length) return true;
      const resumeText = resumeTextByTalentId[candidate.talentId || `recommendation:${candidate.key}`] || '';
      if (words.every((word) => wordPosition(resumeText, word) >= 0)) return true;
      return words.length === 1 && [candidate.candidateName, candidate.candidateCode, candidate.item.jdTitle]
        .some((value) => wordPosition(String(value || ''), words[0]) >= 0);
    }).sort((a, b) => new Date(b.item.uploadedAt).getTime() - new Date(a.item.uploadedAt).getTime());
  }, [availableCandidates, candidateQuery, resumeTextByTalentId]);

  const candidates = useMemo(() => availableCandidates.filter((candidate) => selectedCandidateKeys.includes(candidate.key)), [availableCandidates, selectedCandidateKeys]);

  const duplicateKeys = useMemo(() => new Set(
    selectedJd
      ? availableCandidates.filter((candidate) => checkAlreadyRecommended(candidate, selectedJd)).map((candidate) => candidate.key)
      : [],
  ), [availableCandidates, checkAlreadyRecommended, selectedJd]);
  const selectedDuplicateCount = candidates.filter((candidate) => duplicateKeys.has(candidate.key)).length;
  const sendableCandidates = candidates.filter((candidate) => !duplicateKeys.has(candidate.key));
  const remainingCandidates = sendableCandidates.filter((candidate) => !['queued', 'sending', 'sent'].includes(sendStates[candidate.key]?.status || 'idle'));
  const sentCount = sendableCandidates.length - remainingCandidates.length;
  const failedCount = remainingCandidates.filter((candidate) => sendStates[candidate.key]?.status === 'failed').length;
  const targetLocked = Object.values(sendStates).some((state) => state.status !== 'idle');

  const toggleCandidate = (key: string) => {
    if (sending || submitLock.current) return;
    setError('');
    setSelectedCandidateKeys((current) => {
      if (current.includes(key)) return current.filter((candidateKey) => candidateKey !== key);
      if (current.length >= 10) {
        setError('一次最多选择 10 位人选，请先发送这一批。');
        return current;
      }
      return [...current, key];
    });
  };

  const syncResponse = (response: DeliveryStatusResponse) => {
    if (response.records?.length) onRecords(response.records);
  };

  const payloadFor = (candidate: BulkRepushCandidate, jd: JD) => {
    const source = candidate.item;
    const candidateName = source.candidateName || candidate.candidateName;
    const resumeFileName = source.resumeFileName || source.fileName;
    return {
      sender: owner,
      target: recipient.trim(),
      fileUrl: source.resumeUrl || '',
      deliveries: [{
        text: buildRepushCopy(source, jd),
        fileName: buildDeliveryFileName(source, jd),
        application: {
          jdId: jd.id,
          candidateCode: source.candidateCode,
          candidateIdentityId: source.candidateIdentityId,
          candidateName,
          jdTitle: jd.title,
          contact: source.contact,
          contactPerson: String(jd.odc || '').trim(),
          organization: recommendationOrganization(jd),
          department: String(jd.department || '').trim(),
          highlights: source.highlights,
          resumeFileName,
          source: 'repush' as const,
          repushSourceId: source.id,
        },
      }],
    };
  };

  const updateCandidateState = (key: string, state: CandidateSendState) => {
    setSendStates((current) => ({ ...current, [key]: state }));
  };

  const handleSend = async (repeatSent = false) => {
    if (!selectedJd || (!repeatSent && remainingCandidates.length === 0) || !recipient.trim() || sending || submitLock.current) return;
    submitLock.current = true;
    setSending(true);
    setError('');
    try {
      const submittedCandidates = repeatSent ? sentRequests.map(row => row.candidate) : remainingCandidates;
      if (repeatSent && sentRequests.some(({ task }) => {
        const application = task.deliveries[0].application;
        return application.jdId !== selectedJd.id || application.jdTitle !== selectedJd.title
          || application.organization !== recommendationOrganization(selectedJd)
          || application.department !== String(selectedJd.department || '').trim()
          || application.contactPerson !== String(selectedJd.odc || '').trim();
      })) throw new Error('岗位或对接信息已变化，请重新选择目标岗位后再发送');
      const tasks = repeatSent ? await renewDeliveryTasks(sentRequests.map(row => row.task)) : await Promise.all(submittedCandidates.map(candidate => createDeliveryTask({
        ...payloadFor(candidate, selectedJd), sourceSnapshot: candidate.item,
      })));
      const responses = await submitDeliveryTasks(tasks, (response, index) => {
        const candidate = submittedCandidates[index];
        if (response.status) syncResponse(response);
        if (response.ok && ['queued', 'sending', 'sent'].includes(response.status || '')) {
          updateCandidateState(candidate.key, {
            status: response.status === 'sent' ? 'sent' : response.status === 'sending' ? 'sending' : 'queued',
          });
        } else {
          updateCandidateState(candidate.key, { status: response.unconfirmed ? 'unconfirmed' : 'failed',
            error: response?.error || '任务暂未确认，请重试查看同一任务' });
        }
      });
      const confirmed = responses.flatMap((result, index) => result.status === 'sent'
        ? [{ task: tasks[index], result, candidate: submittedCandidates[index] }] : []);
      setSentRequests(confirmed);
      const failed = responses.filter(response => !response.ok || !['queued', 'sending', 'sent'].includes(response.status || '')).length;
      if (!failed && confirmed.length === 0) onClose();
      else if (!failed) setError(`其中 ${confirmed.length} 项已于 ${deliverySentTime(confirmed[0].result)} 送达，如需再次发送请单独确认。`);
      else setError(`已确认 ${tasks.length - failed}/${tasks.length} 位人选，其他人选请查看各自状态；再次点击只处理未确认或失败的任务。`);
    } catch (error) {
      setError(deliveryClientError(error));
    } finally {
      submitLock.current = false;
      setSending(false);
    }
  };

  const allSent = sendableCandidates.length > 0 && remainingCandidates.length === 0;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-label="批量复推到同一岗位">
      <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-50 text-violet-600"><Repeat2 className="h-5 w-5" /></span>
              同岗复推
            </h2>
            <p className="mt-1 pl-11 text-xs text-slate-400">搜索历史推荐人选的简历正文，选中人选和目标岗位后复推</p>
          </div>
          <button type="button" onClick={onClose} disabled={sending} className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed" aria-label="关闭">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[minmax(300px,0.85fr)_minmax(0,1.35fr)] lg:overflow-hidden">
          <section className="border-b border-slate-100 p-5 lg:overflow-y-auto lg:border-b-0 lg:border-r">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800"><Users className="h-4 w-4 text-indigo-500" />选择复推人选</h3>
                <p className="mt-1 text-xs text-slate-400">已选 {candidates.length}/10 · {sentCount}/{sendableCandidates.length} 已入队</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-50 px-2.5 py-2 text-xs text-indigo-600">
                  {loadingResumes && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {loadingResumes ? resumeLoadAction === 'scan' && resumeProgress.total ? `补全简历 ${resumeProgress.done}/${resumeProgress.total}` : '读取简历正文中' : `历史人选 ${availableCandidates.length} 位`}
                </span>
                {resumeTextsLoaded && pendingResumeCount > 0 && !loadingResumes && (
                  <button type="button" disabled={sending} onClick={() => { setResumeLoadAction('scan'); setResumeLoadVersion((value) => value + 1); }} className="rounded-lg border border-indigo-200 bg-white px-2.5 py-2 text-xs text-indigo-600 hover:bg-indigo-50 disabled:opacity-50">
                    统一补全正文（{pendingResumeCount}）
                  </button>
                )}
              </div>
            </div>
            <div className="relative mb-3">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={candidateQuery} onChange={(event) => setCandidateQuery(event.target.value)} disabled={sending} placeholder="搜简历关键词，如 go php、渠道 运营；也可搜姓名或编号" autoComplete="off" className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50" />
            </div>
            <p className="mb-3 rounded-lg bg-indigo-50 px-3 py-2 text-xs leading-5 text-indigo-700">
              {searchWords(candidateQuery).length > 1 ? '所有关键词都在同一份简历正文出现才会命中。' : '按简历正文搜索，单个词也支持姓名、编号和原岗位。'}
              已找到 {filteredCandidates.length} 位，按最近推荐时间排序。{loadingResumes && resumeLoadAction === 'scan' && ' 简历补全中，结果会持续更新。'}补全成功后会长期保存，下次打开只读取。
            </p>
            {resumeLoadError && <p className="mb-3 text-xs leading-5 text-amber-600">{resumeLoadError} {!resumeTextsLoaded && <button type="button" disabled={loadingResumes || sending} onClick={() => { setResumeLoadAction('read'); setResumeLoadVersion((value) => value + 1); }} className="underline">重新读取</button>}</p>}
            <div className="space-y-2">
              {filteredCandidates.slice(0, visibleCandidateCount).map((candidate) => {
                const selected = selectedCandidateKeys.includes(candidate.key);
                const duplicate = duplicateKeys.has(candidate.key);
                const state = sendStates[candidate.key] || { status: 'idle' as const };
                const meta = sendStatusMeta(state.status);
                const resumeText = resumeTextByTalentId[candidate.talentId || `recommendation:${candidate.key}`] || '';
                const excerpts = resumeExcerpt(resumeText, searchWords(candidateQuery));
                return (
                  <button type="button" key={candidate.key} disabled={sending} onClick={() => toggleCandidate(candidate.key)} className={cn(
                    'w-full rounded-lg border px-3 py-3 text-left transition-colors',
                    selected ? 'border-indigo-300 bg-indigo-50/60 ring-1 ring-indigo-100' : 'border-slate-200 bg-white hover:border-indigo-200',
                  )}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-2.5">
                        <span className={cn('mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border-2', selected ? 'border-indigo-500 bg-indigo-500 text-white' : 'border-slate-300 bg-white')}>
                          {selected && <Check className="h-3 w-3" />}
                        </span>
                        <span className="min-w-0">
                          <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-slate-800">
                            <span>{candidate.candidateName}</span>
                            <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500" title={`最近一次推荐：${formatLastRecommendedAt(candidate.item.uploadedAt)}`}>
                              <Clock3 className="h-3 w-3" />上次推荐 {formatLastRecommendedAt(candidate.item.uploadedAt)}
                            </span>
                            {candidate.hasInterview && (
                              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                                <CalendarCheck className="h-3 w-3" />约面
                              </span>
                            )}
                            {candidate.interviewFailed && (
                              <span className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-700">
                                <CircleX className="h-3 w-3" />未通过
                              </span>
                            )}
                          </span>
                          <span className="mt-1 block truncate text-xs text-slate-400">{candidate.candidateCode || '暂无候选人编码'} · {candidate.item.jdTitle || '原岗位待确认'}</span>
                        </span>
                      </div>
                      <span className="flex shrink-0 flex-col items-end gap-1.5">
                        {!resumeText && <span className="rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-700">{resumeTextsLoaded ? '正文待补' : resumeLoadError ? '正文读取失败' : '正文读取中'}</span>}
                        {selected && (
                          <span className={cn('rounded-md px-2 py-1 text-xs font-medium', duplicate ? 'bg-slate-200 text-slate-500' : meta.className)}>
                            {duplicate ? '已投过该岗位' : meta.label}
                          </span>
                        )}
                      </span>
                    </div>
                    {excerpts.length > 0 && <div className="mt-2 space-y-1 pl-7 text-[11px] leading-4 text-slate-500">
                      {excerpts.map((excerpt) => <p key={excerpt} className="line-clamp-2">…{excerpt}…</p>)}
                    </div>}
                    {state.error && <p className="mt-2 text-xs text-rose-600">{state.error}</p>}
                  </button>
                );
              })}
              {filteredCandidates.length > visibleCandidateCount && <button type="button" onClick={() => setVisibleCandidateCount((count) => count + 50)} className="w-full py-3 text-xs text-indigo-600 hover:text-indigo-700">加载更多（已显示 {visibleCandidateCount}/{filteredCandidates.length}）</button>}
              {filteredCandidates.length === 0 && <p className="py-10 text-center text-sm text-slate-400">{loadingResumes ? '正在读取简历正文，请稍候…' : '暂无同时包含这些关键词的简历，请调整搜索词。'}</p>}
            </div>
          </section>

          <section className="flex min-h-[460px] flex-col p-5 lg:min-h-0 lg:overflow-hidden">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800"><FileText className="h-4 w-4 text-violet-500" />选择同一个目标岗位</h3>
                <p className="mt-1 text-xs text-slate-400">找到合适的人选后选择复推的目标岗位</p>
              </div>
              {selectedJd && <span className="rounded-md bg-violet-50 px-2 py-1 text-xs font-medium text-violet-700">已选择 1 个岗位</span>}
            </div>
            <div className="relative mb-3">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={jobQuery} onChange={(event) => setJobQuery(event.target.value)} disabled={sending || targetLocked} placeholder="搜索岗位、编制或部门" autoComplete="off" className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-violet-300 focus:ring-2 focus:ring-violet-100 disabled:bg-slate-50" />
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
              {matchingJds.map((jd) => {
                const selected = selectedJdId === jd.id;
                return (
                  <button key={jd.id} type="button" disabled={sending || targetLocked} onClick={() => {
                    const nextJdId = selected ? '' : jd.id;
                    if (selectedJdId !== nextJdId) setSelectedCandidateKeys([]);
                    setSelectedJdId(nextJdId);
                  }} className={cn(
                    'flex w-full items-start gap-3 rounded-lg border px-3 py-3 text-left transition-colors',
                    selected ? 'border-violet-300 bg-violet-50 ring-1 ring-violet-100' : 'border-slate-200 bg-white hover:border-violet-200 hover:bg-violet-50/40',
                  )}>
                    <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2', selected ? 'border-violet-500 bg-violet-500 text-white' : 'border-slate-300')}>
                      {selected && <Check className="h-3 w-3" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-800">
                        <span>{jd.title}</span>
                        {newJdIds.has(jd.id) && <span className="shrink-0 rounded bg-red-500 px-1 py-0.5 text-[10px] font-bold leading-none text-white">新</span>}
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">HC {jd.headcount?.trim() || '未填写'}</span>
                        {jd.status === 'urgent' && <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-600">急招</span>}
                      </span>
                      <span className="mt-1 block truncate text-xs text-slate-400">{recommendationOrganization(jd)}{jd.department ? ` / ${jd.department}` : ''}</span>
                    </span>
                  </button>
                );
              })}
              {matchingJds.length === 0 && <p className="py-12 text-center text-sm text-slate-400">没有找到相关岗位</p>}
            </div>
          </section>
        </div>

        <footer className="border-t border-slate-100 px-5 py-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
            <div className="min-w-0 flex-1">
              <label htmlFor="bulk-repush-recipient" className="mb-1.5 block text-xs font-medium text-slate-500">统一发送给</label>
              <div className="relative">
                <Users className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input id="bulk-repush-recipient" list="bulk-repush-tg-dialogs" value={recipient} onChange={(event) => { setRecipient(event.target.value); setError(''); }} disabled={sending || targetLocked} placeholder="@ojisamer" className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-violet-300 focus:ring-2 focus:ring-violet-100" />
                <datalist id="bulk-repush-tg-dialogs">
                  {tgDialogs.map((dialog) => <option key={dialog.id} value={dialog.target}>{dialog.title || dialog.username}</option>)}
                </datalist>
              </div>
              {selectedJd && selectedDuplicateCount > 0 && <p className="mt-1.5 text-xs text-amber-600">已排除 {selectedDuplicateCount} 位投递过该岗位的人选，不会重复发送。</p>}
              {error && <p role="alert" className="mt-1.5 text-xs text-rose-600">{error}</p>}
              {sentRequests.length > 0 && <button type="button" disabled={sending}
                onClick={() => {
                  if (window.confirm(`这 ${sentRequests.length} 位人选此前已送达。确定再次发送相同文案和附件吗？`)) void handleSend(true);
                }} className="mt-1.5 text-xs text-violet-600 underline disabled:opacity-40">确认再次发送已送达项（{sentRequests.length}）</button>}
            </div>
            <div className="flex shrink-0 items-center justify-end gap-2">
              <button type="button" onClick={onClose} disabled={sending} className="h-10 rounded-lg px-3 text-sm font-medium text-slate-500 hover:bg-slate-100 disabled:cursor-not-allowed">取消</button>
              <button type="button" onClick={() => void handleSend()} disabled={!selectedJd || !recipient.trim() || sendableCandidates.length === 0 || sending || allSent} className="inline-flex h-10 items-center gap-2 rounded-lg bg-violet-600 px-4 text-sm font-medium text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-slate-200">
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : allSent ? <Check className="h-4 w-4" /> : <Send className="h-4 w-4" />}
                {sending
                  ? `正在提交 ${sendableCandidates.length} 位人选…`
                  : allSent
                    ? '全部已入队'
                    : failedCount > 0
                      ? `重试未完成（${remainingCandidates.length}）`
                      : `发送并复推（${sendableCandidates.length}）`}
              </button>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
