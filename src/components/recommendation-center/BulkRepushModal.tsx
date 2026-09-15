'use client';

import { useEffect, useMemo, useState } from 'react';
import { CalendarCheck, Check, CircleX, Clock3, FileText, Loader2, Repeat2, Search, Send, Users, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { recommendationOrganization } from '@/lib/recommendation-copy';
import {
  sameJobCoreRules,
  prescreenSameJobCandidates,
  meetsCoreRules,
  type SameJobCandidateInput,
  type CorePrescreenResult,
} from '@/lib/same-job-match';
import { useEscapeClose } from '@/hooks/useEscapeClose';
import type { JD } from '@/types/jd';
import type { RepushColumnId, RepushItem } from '@/store/repush-store';
import { buildDeliveryFileName, buildRepushCopy } from './RepushModal';

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
}

type CandidateSendStatus = 'idle' | 'queued' | 'sending' | 'sent' | 'failed';

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

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function sendStatusMeta(status: CandidateSendStatus) {
  if (status === 'sent') return { label: '已发送', className: 'bg-emerald-50 text-emerald-700' };
  if (status === 'failed') return { label: '发送失败', className: 'bg-rose-50 text-rose-700' };
  if (status === 'sending') return { label: '发送中', className: 'bg-blue-50 text-blue-700' };
  if (status === 'queued') return { label: '排队中', className: 'bg-violet-50 text-violet-700' };
  return { label: '待发送', className: 'bg-slate-100 text-slate-500' };
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
  const [matchError, setMatchError] = useState('');
  const [coreSelection, setCoreSelection] = useState<{ rules: ReturnType<typeof sameJobCoreRules> | null; ids: string[] }>({ rules: null, ids: [] });
  const [coreMode, setCoreMode] = useState<'all' | 'any'>('all');
  const [candidateView, setCandidateView] = useState<'matched' | 'all' | 'selected'>('matched');
  const [resumeTextByTalentId, setResumeTextByTalentId] = useState<Record<string, string>>({});
  const [loadingResumes, setLoadingResumes] = useState(false);
  const [resumeLoadError, setResumeLoadError] = useState('');
  const [resumeLoadVersion, setResumeLoadVersion] = useState(0);
  const [rankState, setRankState] = useState<{
    rules: ReturnType<typeof sameJobCoreRules> | null;
    inputs: SameJobCandidateInput[] | null;
    results: Map<string, CorePrescreenResult>;
  }>({ rules: null, inputs: null, results: new Map() });
  const [visibleCandidateCount, setVisibleCandidateCount] = useState(50);
  useEscapeClose(onClose);

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
    setMatchError('');
    setCoreMode('all');
    setCandidateView('matched');
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

  const selectedJd = jds.find((jd) => jd.id === selectedJdId) || null;
  const coreRules = useMemo(() => selectedJd
    ? sameJobCoreRules(selectedJd)
    : [], [selectedJd]);
  const selectedCoreIds = useMemo(() => coreSelection.rules === coreRules
    ? coreSelection.ids : coreRules.filter((rule) => rule.defaultSelected).map((rule) => rule.id), [coreSelection, coreRules]);
  const attributeRules = coreRules.filter((rule) => rule.kind === 'attribute');
  const adjustableRules = coreRules.filter((rule) => rule.kind !== 'attribute');
  const selectedElementIds = selectedCoreIds.filter((id) => !id.startsWith('attribute:'));

  // Read all available resumes in bounded batches; no model request is needed.
  useEffect(() => {
    const controller = new AbortController();
    const ids = Array.from(new Set(availableCandidates.filter((candidate) => candidate.talentId && candidate.hasResumeText)
      .map((candidate) => candidate.talentId!)));
    const load = async () => {
      setLoadingResumes(ids.length > 0);
      setResumeLoadError('');
      let incomplete = false;
      try {
        for (let index = 0; index < ids.length; index += 50) {
          const response = await fetch('/api/talent/text', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: ids.slice(index, index + 50) }), cache: 'no-store',
            signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
          });
          const data = await response.json() as { items?: Array<{ id: string; text: string }> };
          if (!response.ok || !Array.isArray(data.items)) throw new Error('读取简历失败');
          controller.signal.throwIfAborted();
          const loaded = Object.fromEntries(data.items.filter((item) => item.id && item.text).map((item) => [item.id, item.text]));
          if (Object.keys(loaded).length < ids.slice(index, index + 50).length) incomplete = true;
          setResumeTextByTalentId((current) => ({ ...current, ...loaded }));
        }
        if (incomplete) setResumeLoadError('部分人选暂无简历正文，已用历史资料预筛，命中需核实。');
      } catch {
        if (!controller.signal.aborted) setResumeLoadError('部分简历暂未读取，正在使用已有资料，筛选结果可能不完整。');
      } finally {
        if (!controller.signal.aborted) setLoadingResumes(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [availableCandidates, resumeLoadVersion]);

  const candidateInputs = useMemo<SameJobCandidateInput[]>(() => availableCandidates.map((candidate) => ({
    key: candidate.key,
    currentJob: candidate.item.jdTitle || '',
    resumeText: (candidate.talentId && resumeTextByTalentId[candidate.talentId]) || candidate.item.rawText || '',
    resumeSource: candidate.talentId && resumeTextByTalentId[candidate.talentId] ? 'full_resume' : 'recommendation_copy',
    highlights: candidate.item.highlights || '',
    uploadedAt: candidate.item.uploadedAt,
    categories: jds.find((jd) => jd.id === candidate.item.jdId)?.categories
      || jds.find((jd) => jd.title.trim().toLowerCase() === String(candidate.item.jdTitle || '').trim().toLowerCase())?.categories,
  })), [availableCandidates, jds, resumeTextByTalentId]);

  useEffect(() => {
    if (!selectedJd) return;
    const controller = new AbortController();
    setMatchError('');
    void prescreenSameJobCandidates(coreRules, candidateInputs, controller.signal, selectedJd)
      .then((results) => {
        if (!controller.signal.aborted) setRankState({
          rules: coreRules, inputs: candidateInputs,
          results: new Map(results.map((result) => [result.candidateKey, result])),
        });
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setRankState({ rules: coreRules, inputs: candidateInputs, results: new Map() });
          setMatchError('标签预筛暂未完成，请重选岗位后再试。');
        }
      });
    return () => controller.abort();
  }, [candidateInputs, selectedJd, coreRules]);
  const ranking = Boolean(selectedJd && (rankState.rules !== coreRules || rankState.inputs !== candidateInputs));
  const localResults = useMemo(() => rankState.rules === coreRules ? rankState.results : new Map<string, CorePrescreenResult>(), [rankState, coreRules]);
  useEffect(() => { setVisibleCandidateCount(50); }, [selectedJdId, candidateQuery, selectedCoreIds, coreMode, candidateView]);

  const filteredCandidates = useMemo(() => {
    const keyword = candidateQuery.trim().toLowerCase();
    return availableCandidates.filter((candidate) => !keyword || [
      candidate.candidateName,
      candidate.candidateCode,
      candidate.item.jdTitle,
      candidate.item.organization,
      candidate.item.department,
      candidate.item.highlights,
      candidate.item.rawText,
      candidate.talentId ? resumeTextByTalentId[candidate.talentId] : '',
    ].some((value) => String(value || '').toLowerCase().includes(keyword)));
  }, [availableCandidates, candidateQuery, resumeTextByTalentId]);

  const matchingCandidates = useMemo(() => filteredCandidates
    .filter((candidate) => candidateView === 'selected' ? selectedCandidateKeys.includes(candidate.key)
      : candidateView === 'all' || meetsCoreRules(localResults.get(candidate.key), selectedCoreIds, coreMode))
    .slice()
    .sort((a, b) => {
    const aHits = localResults.get(a.key)?.hits.filter((hit) => selectedCoreIds.includes(hit.ruleId)) || [];
    const bHits = localResults.get(b.key)?.hits.filter((hit) => selectedCoreIds.includes(hit.ruleId)) || [];
    const policyDifference = (localResults.get(b.key)?.policyScoreAdjustment || 0)
      - (localResults.get(a.key)?.policyScoreAdjustment || 0);
    return policyDifference
      || bHits.length - aHits.length
      || bHits.filter((hit) => hit.confirmed).length - aHits.filter((hit) => hit.confirmed).length
      || new Date(b.item.uploadedAt).getTime() - new Date(a.item.uploadedAt).getTime();
  }), [candidateView, selectedCandidateKeys, filteredCandidates, localResults, selectedCoreIds, coreMode]);

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
  const coreMatchCount = filteredCandidates.filter((candidate) => meetsCoreRules(localResults.get(candidate.key), selectedCoreIds, coreMode)).length;
  const changeCoreSelection = (ids: string[]) => {
    const requiredAttributes = attributeRules.map((rule) => rule.id);
    setCoreSelection({ rules: coreRules, ids: Array.from(new Set([...requiredAttributes, ...ids.filter((id) => !id.startsWith('attribute:'))])) });
    setCandidateView('matched');
  };

  const toggleCandidate = (key: string) => {
    if (sending) return;
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
      fileUrl: source.resumeUrl,
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

  const storageKeyFor = async (payload: object) => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(payload)));
    return `recruit:bulk-repush-delivery:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  };

  const updateCandidateState = (key: string, state: CandidateSendState) => {
    setSendStates((current) => ({ ...current, [key]: state }));
  };

  const handleSend = async () => {
    if (!selectedJd || remainingCandidates.length === 0 || !recipient.trim() || sending) return;
    setSending(true);
    setError('');
    try {
      const tasks = await Promise.all(remainingCandidates.map(async candidate => {
        const payload = payloadFor(candidate, selectedJd);
        const storageKey = await storageKeyFor(payload);
        const previousId = window.localStorage.getItem(storageKey);
        const requestId = previousId || crypto.randomUUID();
        window.localStorage.setItem(storageKey, requestId);
        return { candidate, body: { ...payload, requestId, retryIfFailed: Boolean(previousId),
          sourceSnapshot: candidate.item } };
      }));
      const body = JSON.stringify({ sender: owner, batch: tasks.map(task => task.body) });
      let result: { ok?: boolean; results?: DeliveryStatusResponse[]; error?: string } | undefined;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const response = await fetch('/api/tg/send', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
            signal: AbortSignal.timeout(25_000),
          });
          const data = await response.json();
          if (!response.ok || !data.ok) throw Object.assign(new Error(data.error || '加入发送队列失败'), {
            retryable: response.status >= 500 || response.status === 408 || response.status === 429,
          });
          result = data;
          break;
        } catch (error) {
          if (attempt === 1 || error && typeof error === 'object' && 'retryable' in error && !error.retryable) throw error;
          await wait(800);
        }
      }
      const byId = new Map((result?.results || []).map(row => [row.id, row]));
      let failed = 0;
      for (const task of tasks) {
        const response = byId.get(task.body.requestId);
        if (response?.ok) {
          syncResponse(response);
          updateCandidateState(task.candidate.key, {
            status: response.status === 'sent' ? 'sent' : response.status === 'sending' ? 'sending' : 'queued',
          });
        } else {
          failed++;
          updateCandidateState(task.candidate.key, { status: 'failed',
            error: response?.error || '任务暂未确认，请重试查看同一任务' });
        }
      }
      if (!failed) onClose();
      else setError(`已入队 ${tasks.length - failed}/${tasks.length} 位人选，剩余项请查看错误后重试。`);
    } catch (error) {
      setError(error instanceof Error ? error.message : '任务暂未确认，请重试查看同一任务');
    } finally {
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
            <p className="mt-1 pl-11 text-xs text-slate-400">先选岗位，按核心标签快速预筛，大方向符合即可手动勾选复推</p>
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
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-50 px-2.5 py-2 text-xs text-indigo-600">
                {(ranking || loadingResumes) && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {ranking ? '更新标签中' : loadingResumes ? '补充简历标签中' : '核心标签预筛'}
              </span>
            </div>
            <div className="relative mb-3">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={candidateQuery} onChange={(event) => setCandidateQuery(event.target.value)} disabled={sending} placeholder="搜索姓名、原岗位、直播、视频、泛娱乐等经历" autoComplete="off" className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50" />
            </div>
            {!selectedJd && <p className="mb-3 rounded-lg bg-violet-50 px-3 py-2 text-xs text-violet-700">请先在右侧选择目标岗位，系统会按该岗位的职责、要求和业务场景筛选。</p>}
            {selectedJd && <p className="mb-3 rounded-lg bg-indigo-50 px-3 py-2 text-xs leading-5 text-indigo-700">
              岗位属性必须符合{selectedElementIds.length ? `，再${coreMode === 'all' ? '满足全部' : '满足任一'}核心元素` : ''}：已找到 ${coreMatchCount} / ${filteredCandidates.length} 位，可手动勾选复推。
              {' 关键经历与组织偏好仅作风险提示和排序，不影响核心标签命中。'}
              {loadingResumes && ' 正在补充简历正文，人数会更新。'}
            </p>}
            {resumeLoadError && <p className="mb-3 text-xs leading-5 text-amber-600">{resumeLoadError} <button type="button" disabled={loadingResumes || sending} onClick={() => setResumeLoadVersion((value) => value + 1)} className="underline">重新读取</button></p>}
            {matchError && <p role="alert" className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-700">{matchError}</p>}
            {selectedJd && (
              <div className="mb-3 flex rounded-lg bg-slate-100 p-1" aria-label="核心标签筛选结果">
                {([['matched', '核心符合'], ['all', '全部人选'], ['selected', `已勾选 ${candidates.length}`]] as const).map(([value, label]) => (
                  <button key={value} type="button" onClick={() => setCandidateView(value)} className={cn(
                    'h-8 flex-1 rounded-md px-2 text-xs font-medium transition-colors',
                    candidateView === value ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700',
                  )}>{label}</button>
                ))}
              </div>
            )}
            <div className="space-y-2">
              {matchingCandidates.slice(0, visibleCandidateCount).map((candidate) => {
                const selected = selectedCandidateKeys.includes(candidate.key);
                const duplicate = duplicateKeys.has(candidate.key);
                const state = sendStates[candidate.key] || { status: 'idle' as const };
                const meta = sendStatusMeta(state.status);
                const coreHits = localResults.get(candidate.key)?.hits.filter((hit) => selectedCoreIds.includes(hit.ruleId)) || [];
                const policyNotes = localResults.get(candidate.key)?.policyNotes || [];
                const attributeHit = coreHits.some((hit) => hit.ruleId.startsWith('attribute:'));
                const elementHits = coreHits.filter((hit) => !hit.ruleId.startsWith('attribute:'));
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
                        {attributeHit && <span className="rounded-md bg-blue-50 px-2 py-1 text-xs text-blue-700">属性符合</span>}
                        {selectedElementIds.length > 0 && <span className="rounded-md bg-violet-50 px-2 py-1 text-xs text-violet-600">核心 {elementHits.length}/{selectedElementIds.length}</span>}
                        {selected && (
                          <span className={cn('rounded-md px-2 py-1 text-xs font-medium', duplicate ? 'bg-slate-200 text-slate-500' : meta.className)}>
                            {duplicate ? '已投过该岗位' : meta.label}
                          </span>
                        )}
                      </span>
                    </div>
                    {coreHits.length > 0 && <div className="mt-2 flex flex-wrap gap-1 pl-7">
                      {coreHits.map((hit) => <span key={hit.ruleId} title={`${hit.confirmed ? '简历原文' : '历史资料，待核实'}：${hit.evidence}`} className={cn(
                        'rounded px-1.5 py-0.5 text-[11px]', hit.confirmed ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700',
                      )}>{hit.label}{hit.ruleId.startsWith('attribute:') ? ' · 必须符合' : hit.confirmed ? ' · 简历命中' : ' · 资料命中待核实'}</span>)}
                    </div>}
                    {policyNotes.length > 0 && <div className="mt-2 space-y-1 pl-7">
                      {policyNotes.map((note) => <p key={note} className={cn(
                        'text-[11px]', note.startsWith('组织偏好') ? 'text-emerald-600' : 'text-rose-600',
                      )}>{note}</p>)}
                    </div>}
                    {state.error && <p className="mt-2 text-xs text-rose-600">{state.error}</p>}
                  </button>
                );
              })}
              {matchingCandidates.length > visibleCandidateCount && <button type="button" onClick={() => setVisibleCandidateCount((count) => count + 50)} className="w-full py-3 text-xs text-indigo-600 hover:text-indigo-700">加载更多（已显示 {visibleCandidateCount}/{matchingCandidates.length}）</button>}
              {matchingCandidates.length === 0 && <p className="py-10 text-center text-sm text-slate-400">{ranking || loadingResumes ? '正在补充标签，请稍候…' : '暂未找到符合当前条件的人选，可调整核心标签或查看全部人选。'}</p>}
            </div>
          </section>

          <section className="flex min-h-[460px] flex-col p-5 lg:min-h-0 lg:overflow-hidden">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800"><FileText className="h-4 w-4 text-violet-500" />选择同一个目标岗位</h3>
                <p className="mt-1 text-xs text-slate-400">从 JD 提取核心方向，点击标签即可调整预筛条件</p>
              </div>
              {selectedJd && <span className="rounded-md bg-violet-50 px-2 py-1 text-xs font-medium text-violet-700">已选择 1 个岗位</span>}
            </div>
            <div className="relative mb-3">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={jobQuery} onChange={(event) => setJobQuery(event.target.value)} disabled={sending || targetLocked} placeholder="搜索岗位、编制或部门" autoComplete="off" className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-violet-300 focus:ring-2 focus:ring-violet-100 disabled:bg-slate-50" />
            </div>
            {selectedJd && (
              <div className="mb-3 rounded-lg border border-violet-100 bg-violet-50/60 px-3 py-2">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-medium text-violet-700">岗位属性优先，再看核心元素</p>
                  <select aria-label="核心标签满足方式" value={coreMode} disabled={sending || targetLocked} onChange={(event) => { setCoreMode(event.target.value as 'all' | 'any'); setCandidateView('matched'); }} className="rounded border border-violet-200 bg-white px-2 py-1 text-xs text-violet-700">
                    <option value="all">全部满足</option><option value="any">满足任一</option>
                  </select>
                </div>
                <p className="mb-2 text-[11px] text-slate-500">岗位属性必须符合；系统再建议最关键的两三个核心元素。</p>
                <div className="flex flex-wrap gap-1">
                  {attributeRules.map((rule) => <span key={rule.id} className="rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white">{rule.label} ✓ 必选</span>)}
                  {adjustableRules.filter((rule) => selectedCoreIds.includes(rule.id)).map((rule) => <button type="button" key={rule.id} aria-pressed={true} disabled={sending || targetLocked} onClick={() => changeCoreSelection(selectedCoreIds.filter((id) => id !== rule.id))} className="rounded bg-violet-600 px-2 py-1 text-xs text-white">{rule.label} ✓</button>)}
                  {!selectedElementIds.length && <span className="text-xs text-slate-500">暂未选择核心元素</span>}
                </div>
                <details className="mt-2 text-xs text-violet-700">
                  <summary className="cursor-pointer">调整核心元素（{adjustableRules.length} 个可选）</summary>
                  <div className="mt-2 flex max-h-32 flex-wrap gap-1 overflow-y-auto">
                    {adjustableRules.map((rule) => <button type="button" key={rule.id} aria-pressed={selectedCoreIds.includes(rule.id)} disabled={sending || targetLocked} onClick={() => changeCoreSelection(selectedCoreIds.includes(rule.id) ? selectedCoreIds.filter((id) => id !== rule.id) : [...selectedCoreIds, rule.id])} className={cn('rounded border px-2 py-1', selectedCoreIds.includes(rule.id) ? 'border-violet-600 bg-violet-600 text-white' : 'border-violet-200 bg-white text-violet-700')}>{rule.label}</button>)}
                  </div>
                  <button type="button" disabled={sending || targetLocked} onClick={() => changeCoreSelection(coreRules.filter((rule) => rule.defaultSelected).map((rule) => rule.id))} className="mt-2 underline">恢复建议标签</button>
                </details>
              </div>
            )}
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
                <input id="bulk-repush-recipient" list="bulk-repush-tg-dialogs" value={recipient} onChange={(event) => { setRecipient(event.target.value); setError(''); }} disabled={sending} placeholder="@ojisamer" className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-violet-300 focus:ring-2 focus:ring-violet-100" />
                <datalist id="bulk-repush-tg-dialogs">
                  {tgDialogs.map((dialog) => <option key={dialog.id} value={dialog.target}>{dialog.title || dialog.username}</option>)}
                </datalist>
              </div>
              {selectedJd && selectedDuplicateCount > 0 && <p className="mt-1.5 text-xs text-amber-600">已排除 {selectedDuplicateCount} 位投递过该岗位的人选，不会重复发送。</p>}
              {error && <p role="alert" className="mt-1.5 text-xs text-rose-600">{error}</p>}
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
