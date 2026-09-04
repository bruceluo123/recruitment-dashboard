'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check, ChevronDown, ChevronUp, Clock3, ExternalLink, FileText,
  Loader2, MessageSquareText, RefreshCw, Repeat2, Search,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { displayName } from '@/lib/repush-format';
import { recommendationOrganization } from '@/lib/recommendation-copy';
import { RepushModal, type RepushArgs } from '@/components/recommendation-center/RepushModal';
import { usePrefStore } from '@/store/pref-store';
import { useJDStore } from '@/store/jd-store';
import { useRepushStore, type RepushColumnId, type RepushItem } from '@/store/repush-store';
import { getPrimaryCategory, hasCategory, JD_CATEGORY_LABELS, type JD, type JDCategory } from '@/types/jd';
import type { FeedbackCenterItem, FeedbackCenterState } from '@/types/feedback-center';

type FeedbackBucket = 'pending' | 'screening_failed' | 'interview_failed';

interface ViewFeedbackItem extends FeedbackCenterItem {
  repushItem?: RepushItem;
  synthetic?: boolean;
}

interface CandidateGroup {
  key: string;
  candidateCode: string;
  candidateName: string;
  items: ViewFeedbackItem[];
  repushItem?: RepushItem;
  latestAt: string;
  bucket: FeedbackBucket;
}

interface RecommendationIndex {
  byId: Map<string, RepushItem>;
  byCandidate: Map<string, RepushItem[]>;
}

interface CachedFeedback {
  expiresAt: number;
  state: FeedbackCenterState;
}

const BUCKETS: Array<{ id: FeedbackBucket; label: string; description: string }> = [
  { id: 'pending', label: '无反馈，去跟进', description: '仍有岗位没有明确结果' },
  { id: 'screening_failed', label: '已反馈，可复推', description: '全部已有初筛结果，可换部门继续推荐' },
  { id: 'interview_failed', label: '面试后，可复推', description: '面试未通过，可重新匹配其他岗位' },
];

const FEEDBACK_CACHE_MS = 60_000;
const feedbackCache = new Map<'a' | 'b', CachedFeedback>();
const feedbackRequests = new Map<'a' | 'b', Promise<FeedbackCenterState>>();

function clean(value?: string): string {
  return String(value || '').trim();
}

function normalize(value?: string): string {
  return clean(value).toLowerCase().replace(/[\s·._-]+/g, '');
}

function dateKey(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function recentDays(): Array<{ key: string; label: string }> {
  const today = new Date();
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setHours(0, 0, 0, 0);
    date.setDate(today.getDate() - (6 - index));
    return { key: dateKey(date), label: `${date.getMonth() + 1}.${date.getDate()}` };
  });
}

function candidateKey(code?: string, name?: string): string {
  return normalize(code) || normalize(name) || 'unknown';
}

function targetKey(title?: string, organization?: string, department?: string): string {
  return [title, organization, department].map(normalize).join('|');
}

function sameCandidate(feedback: FeedbackCenterItem, item: RepushItem): boolean {
  if (feedback.owner !== item.column) return false;
  const feedbackCode = normalize(feedback.candidateCode);
  const itemCode = normalize(item.candidateCode);
  if (feedbackCode && itemCode) return feedbackCode === itemCode;
  return normalize(feedback.candidateName) === normalize(item.candidateName || displayName(item).split('-')[0]);
}

function sameTarget(feedback: FeedbackCenterItem, item: RepushItem): boolean {
  if (!sameCandidate(feedback, item)) return false;
  if (normalize(feedback.jobTitle) !== normalize(item.jdTitle || item.fileName)) return false;
  if (feedback.organization && item.organization
    && normalize(feedback.organization) !== normalize(item.organization)) return false;
  if (feedback.department && item.department
    && normalize(feedback.department) !== normalize(item.department)) return false;
  return true;
}

function feedbackLookupKey(feedback: FeedbackCenterItem): string {
  const code = normalize(feedback.candidateCode);
  return code ? `code:${code}` : `name:${normalize(feedback.candidateName)}`;
}

function recommendationLookupKeys(item: RepushItem): string[] {
  const keys: string[] = [];
  const code = normalize(item.candidateCode);
  const name = normalize(item.candidateName || displayName(item).split('-')[0]);
  if (code) keys.push(`code:${code}`);
  if (name) keys.push(`name:${name}`);
  return keys;
}

function linkedRecommendation(feedback: FeedbackCenterItem, index: RecommendationIndex): RepushItem | undefined {
  const byId = feedback.recommendationId ? index.byId.get(feedback.recommendationId) : undefined;
  if (byId) return byId;

  const candidates = index.byCandidate.get(feedbackLookupKey(feedback)) || [];
  const byTarget = candidates.find((item) => sameTarget(feedback, item));
  if (byTarget) return byTarget;

  return candidates.length === 1 ? candidates[0] : undefined;
}

async function fetchFeedback(owner: 'a' | 'b', force: boolean): Promise<FeedbackCenterState> {
  const cached = feedbackCache.get(owner);
  if (!force && cached && cached.expiresAt > Date.now()) return cached.state;
  const pending = feedbackRequests.get(owner);
  if (!force && pending) return pending;

  const params = new URLSearchParams({ owner, days: '7' });
  if (force) params.set('refresh', '1');
  const request = fetch(`/api/feedback-center?${params.toString()}`, {
    cache: force ? 'no-store' : 'default',
  }).then(async (response) => {
    const data = await response.json() as FeedbackCenterState & { ok?: boolean; error?: string };
    if (!response.ok || data.ok === false) throw new Error(data.error || '读取反馈失败');
    const state: FeedbackCenterState = {
      version: 1,
      generatedAt: data.generatedAt || '',
      items: Array.isArray(data.items) ? data.items : [],
    };
    feedbackCache.set(owner, { expiresAt: Date.now() + FEEDBACK_CACHE_MS, state });
    return state;
  }).finally(() => {
    if (feedbackRequests.get(owner) === request) feedbackRequests.delete(owner);
  });
  feedbackRequests.set(owner, request);
  return request;
}

function effectiveStatus(item: FeedbackCenterItem): 'pending' | 'screening_failed' | 'interview_failed' | 'closed' {
  if (item.confirmedStatus === 'closed' || item.confirmedStatus === 'interview_passed') return 'closed';
  if (item.confirmedStatus === 'interview_failed' || item.sourceStatus === 'interview_failed') return 'interview_failed';
  if (item.confirmedStatus === 'screening_failed' || item.sourceStatus === 'screening_failed') return 'screening_failed';
  return 'pending';
}

function groupBucket(items: ViewFeedbackItem[]): FeedbackBucket | null {
  const statuses = items.map(effectiveStatus);
  if (statuses.some((status) => status === 'pending')) return 'pending';
  if (statuses.some((status) => status === 'interview_failed')) return 'interview_failed';
  if (statuses.some((status) => status === 'screening_failed')) return 'screening_failed';
  return null;
}

function statusMeta(item: ViewFeedbackItem): { label: string; className: string } {
  if (item.sourceStatus === 'manual_review') {
    return { label: 'OCR 待核对', className: 'bg-violet-50 text-violet-700 ring-violet-200' };
  }
  const status = effectiveStatus(item);
  if (status === 'screening_failed') return { label: '初筛未通过', className: 'bg-slate-100 text-slate-600 ring-slate-200' };
  if (status === 'interview_failed') return { label: '面试未通过', className: 'bg-rose-50 text-rose-700 ring-rose-200' };
  if (status === 'closed') return { label: '已有结果', className: 'bg-emerald-50 text-emerald-700 ring-emerald-200' };
  if (item.sourceStatus === 'scheduled' || item.confirmedStatus === 'interview_pending') {
    return { label: '面试待反馈', className: 'bg-blue-50 text-blue-700 ring-blue-200' };
  }
  return { label: '待反馈', className: 'bg-amber-50 text-amber-700 ring-amber-200' };
}

function inferCategory(title: string, jds: JD[]): JDCategory | undefined {
  const exact = jds.find((jd) => normalize(jd.title) === normalize(title));
  if (exact) return getPrimaryCategory(exact);
  const rules: Array<[RegExp, JDCategory]> = [
    [/flutter|前端|web|react|vue|android|ios/i, 'frontend'],
    [/go\b|golang|java|php|node|后端|服务端/i, 'backend'],
    [/测试|qa\b/i, 'testing'], [/运营/i, 'operations'], [/内容/i, 'content'],
    [/产品/i, 'product'], [/设计|ui|ux/i, 'design'], [/ai|aigc|agent|大模型/i, 'ai'],
    [/数据|数仓/i, 'data'], [/法务|合规/i, 'legal'], [/hr|人力/i, 'hr'],
  ];
  return rules.find(([pattern]) => pattern.test(title))?.[1];
}

function suggestedJobs(group: CandidateGroup, jds: JD[]): JD[] {
  const used = new Set(group.items.map((item) => targetKey(item.jobTitle, item.organization, item.department)));
  const category = group.items.map((item) => inferCategory(item.jobTitle, jds)).find(Boolean);
  return jds
    .filter((jd) => jd.status !== 'paused')
    .filter((jd) => !used.has(targetKey(jd.title, recommendationOrganization(jd), jd.department)))
    .filter((jd) => !category || hasCategory(jd, category))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 10);
}

export function RepushPoolPage() {
  const [mounted, setMounted] = useState(false);
  const [feedbackItems, setFeedbackItems] = useState<FeedbackCenterItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeBucket, setActiveBucket] = useState<FeedbackBucket>('pending');
  const [selectedDay, setSelectedDay] = useState('all');
  const [expandedKey, setExpandedKey] = useState('');
  const [detailsById, setDetailsById] = useState<Record<string, FeedbackCenterItem>>({});
  const [loadingDetailsKey, setLoadingDetailsKey] = useState('');
  const [repushing, setRepushing] = useState<CandidateGroup | null>(null);
  const [updatingId, setUpdatingId] = useState('');

  const items = useRepushStore((state) => state.items);
  const columnNames = useRepushStore((state) => state.columnNames);
  const addRecommendation = useRepushStore((state) => state.addRecommendation);
  const jds = useJDStore((state) => state.jds);
  const owner = usePrefStore((state) => state.activeOwner);
  const setOwner = usePrefStore((state) => state.setActiveOwner);
  const days = useMemo(recentDays, []);
  const recentDayKeys = useMemo(() => new Set(days.map((day) => day.key)), [days]);

  useEffect(() => setMounted(true), []);

  const loadFeedback = useCallback(async (force = false) => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchFeedback(owner, force);
      setFeedbackItems(data.items);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '读取反馈失败');
    } finally {
      setLoading(false);
    }
  }, [owner]);

  useEffect(() => {
    setExpandedKey('');
    setDetailsById({});
    void loadFeedback(false);
  }, [loadFeedback]);

  const recentRecommendations = useMemo(() => items.filter((item) => (
    item.column === owner && recentDayKeys.has(dateKey(item.uploadedAt))
  )), [items, owner, recentDayKeys]);

  const recommendationIndex = useMemo<RecommendationIndex>(() => {
    const byId = new Map<string, RepushItem>();
    const byCandidate = new Map<string, RepushItem[]>();
    for (const item of recentRecommendations) {
      byId.set(item.id, item);
      for (const key of recommendationLookupKeys(item)) {
        const matches = byCandidate.get(key);
        if (matches) matches.push(item);
        else byCandidate.set(key, [item]);
      }
    }
    return { byId, byCandidate };
  }, [recentRecommendations]);

  const mergedItems = useMemo<ViewFeedbackItem[]>(() => {
    const apiItems = feedbackItems
      .filter((item) => item.owner === owner)
      .flatMap<ViewFeedbackItem>((feedback) => {
        const repushItem = linkedRecommendation(feedback, recommendationIndex);
        if (!repushItem) return [];
        return [{
          ...feedback,
          recommendationId: repushItem.id,
          owner: repushItem.column,
          candidateCode: repushItem.candidateCode || feedback.candidateCode,
          candidateName: repushItem.candidateName || displayName(repushItem).split('-')[0] || feedback.candidateName,
          jobTitle: repushItem.jdTitle || feedback.jobTitle,
          organization: repushItem.organization || feedback.organization,
          department: repushItem.department || feedback.department,
          recommendedAt: repushItem.uploadedAt,
          repushItem,
        }];
      });

    const linkedIds = new Set(apiItems.map((item) => item.recommendationId).filter(Boolean));
    const synthetic = recentRecommendations
      .filter((item) => !linkedIds.has(item.id))
      .map<ViewFeedbackItem>((item) => ({
        id: `local-${item.id}`,
        recommendationId: item.id,
        owner: item.column,
        candidateCode: item.candidateCode,
        candidateName: item.candidateName || displayName(item).split('-')[0],
        jobTitle: item.jdTitle || item.fileName,
        organization: item.organization,
        department: item.department,
        contactPerson: item.contactPerson,
        recommendedAt: item.uploadedAt,
        interviewStatus: item.interviewStatus,
        sourceStatus: item.interviewStatus === 'scheduled' ? 'scheduled' : 'no_feedback',
        sourceSummary: item.interviewStatus === 'scheduled' ? '已有面试记录，等待反馈' : '近 7 天反馈截图中未找到明确结论',
        followUpCount: 0,
        repushReady: false,
        timeline: [],
        updatedAt: item.updatedAt || item.uploadedAt,
        repushItem: item,
        synthetic: true,
      }));
    return [...apiItems, ...synthetic];
  }, [feedbackItems, owner, recentRecommendations, recommendationIndex]);

  const groups = useMemo<CandidateGroup[]>(() => {
    const map = new Map<string, ViewFeedbackItem[]>();
    for (const item of mergedItems) {
      if (selectedDay !== 'all' && dateKey(item.recommendedAt || item.updatedAt) !== selectedDay) continue;
      const key = candidateKey(item.candidateCode, item.candidateName);
      const groupItems = map.get(key);
      if (groupItems) groupItems.push(item);
      else map.set(key, [item]);
    }
    return Array.from(map.entries()).flatMap(([key, groupItems]) => {
      const bucket = groupBucket(groupItems);
      if (!bucket) return [];
      const latestAt = groupItems.reduce((latest, item) => {
        const current = item.recommendedAt || item.updatedAt;
        return new Date(current).getTime() > new Date(latest).getTime() ? current : latest;
      }, groupItems[0].recommendedAt || groupItems[0].updatedAt);
      return [{
        key,
        candidateCode: clean(groupItems.find((item) => item.candidateCode)?.candidateCode),
        candidateName: clean(groupItems.find((item) => item.candidateName)?.candidateName) || '未命名人选',
        items: groupItems.sort((a, b) => new Date(b.recommendedAt || b.updatedAt).getTime() - new Date(a.recommendedAt || a.updatedAt).getTime()),
        repushItem: groupItems.find((item) => item.repushItem?.resumeUrl)?.repushItem || groupItems.find((item) => item.repushItem)?.repushItem,
        latestAt,
        bucket,
      }];
    }).sort((a, b) => new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime());
  }, [mergedItems, selectedDay]);

  const counts = useMemo(() => BUCKETS.reduce<Record<FeedbackBucket, number>>((result, bucket) => {
    result[bucket.id] = groups.filter((group) => group.bucket === bucket.id).length;
    return result;
  }, { pending: 0, screening_failed: 0, interview_failed: 0 }), [groups]);

  const selectedRecommendations = useMemo(() => recentRecommendations.filter((item) => (
    selectedDay === 'all' || dateKey(item.uploadedAt) === selectedDay
  )), [recentRecommendations, selectedDay]);
  const selectedCandidateCount = useMemo(() => new Set(selectedRecommendations.map((item) => (
    candidateKey(item.candidateCode, item.candidateName || displayName(item).split('-')[0])
  ))).size, [selectedRecommendations]);

  const visibleGroups = groups.filter((group) => group.bucket === activeBucket);

  const toggleGroup = async (group: CandidateGroup) => {
    if (expandedKey === group.key) {
      setExpandedKey('');
      return;
    }
    setExpandedKey(group.key);
    const missing = group.items.filter((item) => !item.synthetic && !detailsById[item.id]);
    if (missing.length === 0) return;
    setLoadingDetailsKey(group.key);
    try {
      const params = new URLSearchParams({ owner, days: '7', detail: '1' });
      missing.forEach((item) => params.append('id', item.id));
      const response = await fetch(`/api/feedback-center?${params.toString()}`, { cache: 'no-store' });
      const data = await response.json() as FeedbackCenterState & { ok?: boolean; error?: string };
      if (!response.ok || data.ok === false) throw new Error(data.error || '读取 OCR 证据失败');
      setDetailsById((current) => ({
        ...current,
        ...Object.fromEntries(data.items.map((item) => [item.id, item])),
      }));
    } catch (detailError) {
      setError(detailError instanceof Error ? detailError.message : '读取 OCR 证据失败');
    } finally {
      setLoadingDetailsKey('');
    }
  };

  const markFollowed = async (group: CandidateGroup) => {
    const target = group.items.find((item) => !item.synthetic && effectiveStatus(item) === 'pending');
    if (!target) return;
    setUpdatingId(target.id);
    try {
      const response = await fetch('/api/feedback-center', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: target.id, owner, action: 'follow_up' }),
      });
      const data = await response.json() as { ok?: boolean; item?: FeedbackCenterItem };
      if (!response.ok || !data.ok || !data.item) throw new Error('保存失败');
      setFeedbackItems((current) => current.map((item) => item.id === target.id ? data.item! : item));
      feedbackCache.delete(owner);
    } catch {
      setError('跟进记录保存失败，请稍后重试');
    } finally {
      setUpdatingId('');
    }
  };

  const confirmRepush = (args: RepushArgs) => {
    if (!repushing?.repushItem) return;
    const source = repushing.repushItem;
    addRecommendation({
      column: source.column,
      candidateCode: source.candidateCode,
      candidateName: source.candidateName || repushing.candidateName,
      jdTitle: args.jdTitle,
      contact: source.contact,
      contactPerson: args.contactPerson,
      rawText: args.recommendationText,
      organization: args.organization,
      department: args.department,
      highlights: source.highlights,
      resumeUrl: source.resumeUrl,
      resumeFileName: source.resumeFileName,
      source: 'repush',
      repushSourceId: source.id,
    });
    setRepushing(null);
  };

  if (!mounted) return null;

  return (
    <div className="workspace-page h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[1500px] pb-10">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <MessageSquareText className="h-7 w-7 text-indigo-500" />
              <h1 className="page-title">反馈中心</h1>
            </div>
            <p className="page-subtitle">近 7 天推荐按人汇总，逐个岗位核对反馈并安排复推。</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex overflow-hidden rounded-lg border border-slate-200 bg-white">
              {(['a', 'b'] as RepushColumnId[]).map((column) => (
                <button key={column} type="button" onClick={() => setOwner(column)} className={cn(
                  'h-10 px-4 text-sm font-medium transition-colors',
                  owner === column ? 'bg-indigo-500 text-white' : 'text-slate-600 hover:bg-slate-50',
                )}>{columnNames[column]}</button>
              ))}
            </div>
            <button type="button" onClick={() => void loadFeedback(true)} disabled={loading} className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50" title="刷新已生成的反馈结果">
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            </button>
          </div>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-3">
          <button type="button" onClick={() => setSelectedDay('all')} className={cn('h-9 rounded-md px-3 text-sm font-medium', selectedDay === 'all' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50')}>全部 7 天</button>
          {days.map((day, index) => (
            <button key={day.key} type="button" onClick={() => setSelectedDay(day.key)} className={cn(
              'h-9 rounded-md px-3 text-sm font-medium transition-colors',
              selectedDay === day.key ? 'bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-200' : 'text-slate-500 hover:bg-slate-50',
            )}>{day.label}{index === days.length - 1 ? ' 今天' : ''}</button>
          ))}
          <div className="ml-auto text-sm text-slate-500">
            {selectedDay === 'all' ? '近 7 天' : '当天'}共 <span className="font-semibold text-slate-800">{selectedRecommendations.length}</span> 次岗位投递，合并为 <span className="font-semibold text-slate-800">{selectedCandidateCount}</span> 位人选
          </div>
        </div>

        <div className="mb-4 grid grid-cols-1 gap-2 md:grid-cols-3">
          {BUCKETS.map((bucket) => (
            <button key={bucket.id} type="button" onClick={() => setActiveBucket(bucket.id)} className={cn(
              'flex min-h-20 items-center justify-between rounded-lg border px-4 text-left transition-all',
              activeBucket === bucket.id ? 'border-indigo-200 bg-indigo-50 ring-1 ring-indigo-100' : 'border-slate-200 bg-white hover:border-slate-300',
            )}>
              <span><span className="block font-semibold text-slate-900">{bucket.label}</span><span className="mt-1 block text-xs text-slate-400">{bucket.description}</span></span>
              <span className={cn('rounded-md px-2.5 py-1 text-lg font-semibold', activeBucket === bucket.id ? 'bg-white text-indigo-600' : 'bg-slate-50 text-slate-600')}>{counts[bucket.id]} 人</span>
            </button>
          ))}
        </div>

        {error && <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}

        {loading ? (
          <div className="flex min-h-80 items-center justify-center rounded-lg border border-slate-200 bg-white text-sm text-slate-500"><Loader2 className="mr-2 h-5 w-5 animate-spin text-indigo-500" />正在读取反馈记录</div>
        ) : visibleGroups.length === 0 ? (
          <div className="flex min-h-72 flex-col items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-400"><Check className="mb-3 h-9 w-9 text-emerald-400" /><p className="font-medium text-slate-600">当前没有需要处理的人选</p><p className="mt-1 text-sm">可切换日期或另一位推荐人查看</p></div>
        ) : (
          <div className="space-y-3">
            {visibleGroups.map((group) => {
              const isExpanded = expandedKey === group.key;
              const feedbackCount = group.items.filter((item) => effectiveStatus(item) !== 'pending').length;
              const pendingCount = group.items.length - feedbackCount;
              const recommendations = isExpanded ? suggestedJobs(group, jds) : [];
              const category = group.items.map((item) => inferCategory(item.jobTitle, jds)).find(Boolean);
              const detailedItems = group.items.map((item) => detailsById[item.id] ? { ...item, ...detailsById[item.id] } : item);
              return (
                <section key={group.key} className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                  <button type="button" onClick={() => void toggleGroup(group)} className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left hover:bg-slate-50/70">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        {group.candidateCode && <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-500">{group.candidateCode}</span>}
                        <h2 className="text-lg font-semibold text-slate-900">{group.candidateName}</h2>
                        {category && <span className="rounded-md bg-indigo-50 px-2 py-1 text-xs text-indigo-600">{JD_CATEGORY_LABELS[category]}</span>}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-500">
                        <span>投递 {group.items.length} 个岗位</span><span className="text-emerald-600">已反馈 {feedbackCount}</span>{pendingCount > 0 && <span className="text-amber-600">待跟进 {pendingCount}</span>}
                      </div>
                    </div>
                    {isExpanded ? <ChevronUp className="h-5 w-5 shrink-0 text-slate-400" /> : <ChevronDown className="h-5 w-5 shrink-0 text-slate-400" />}
                  </button>

                  <div className="grid gap-2 border-t border-slate-100 bg-slate-50/60 p-4 sm:grid-cols-2 xl:grid-cols-3">
                    {group.items.map((item) => {
                      const meta = statusMeta(item);
                      return (
                        <div key={item.id} className="rounded-md border border-slate-200 bg-white p-3">
                          <div className="flex items-start justify-between gap-2"><p className="font-medium leading-6 text-slate-800">{item.jobTitle}</p><span className={cn('shrink-0 rounded px-2 py-1 text-xs ring-1 ring-inset', meta.className)}>{meta.label}</span></div>
                          <p className="mt-2 text-sm text-slate-500">{[item.organization, item.department].filter(Boolean).join(' / ') || '部门待补充'}</p>
                          {(item.sourceSummary || item.auditConclusion) && <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-400">{item.sourceSummary || item.auditConclusion}</p>}
                        </div>
                      );
                    })}
                  </div>

                  {isExpanded && (
                    <div className="grid gap-5 border-t border-slate-100 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
                      <div>
                        <div className="mb-3 flex items-center justify-between"><h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800"><FileText className="h-4 w-4 text-indigo-500" />简历与 OCR 记录</h3>{group.repushItem?.resumeUrl && <a href={group.repushItem.resumeUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-indigo-600 hover:underline">打开原简历<ExternalLink className="h-3 w-3" /></a>}</div>
                        <div className="max-h-56 overflow-y-auto rounded-md border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-600 whitespace-pre-wrap">{group.repushItem?.rawText || group.repushItem?.highlights || '暂无可预览的简历正文，可打开原简历查看。'}</div>
                        <div className="mt-3 space-y-2">
                          {loadingDetailsKey === group.key && <div className="flex items-center gap-2 rounded-md border border-slate-100 px-3 py-2 text-xs text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" />正在读取 OCR 证据</div>}
                          {detailedItems.filter((item) => item.sourceEvidence || item.sourceSummary).map((item) => <div key={item.id} className="rounded-md border border-slate-100 px-3 py-2 text-xs leading-5 text-slate-500"><span className="font-medium text-slate-700">{item.jobTitle}：</span>{item.sourceEvidence || item.sourceSummary}</div>)}
                          {loadingDetailsKey !== group.key && detailedItems.every((item) => !item.sourceEvidence && !item.sourceSummary) && <p className="text-xs text-slate-400">暂无 OCR 文字证据。</p>}
                        </div>
                      </div>
                      <div>
                        <div className="mb-3 flex items-center justify-between gap-3"><div><h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800"><Search className="h-4 w-4 text-violet-500" />还能复推的岗位</h3><p className="mt-1 text-xs text-slate-400">同类别、排除已推荐岗位，展示最近更新的前 10 个</p></div></div>
                        <div className="grid max-h-48 gap-2 overflow-y-auto sm:grid-cols-2">
                          {recommendations.length > 0 ? recommendations.map((jd) => <div key={jd.id} className="rounded-md border border-slate-200 px-3 py-2"><p className="truncate text-sm font-medium text-slate-700">{jd.title}</p><p className="mt-1 truncate text-xs text-slate-400">{recommendationOrganization(jd)}{jd.department ? ` / ${jd.department}` : ''}</p></div>) : <p className="text-sm text-slate-400">暂未找到新的同类岗位</p>}
                        </div>
                        <div className="mt-4 flex flex-wrap justify-end gap-2">
                          {activeBucket === 'pending' && <button type="button" onClick={() => void markFollowed(group)} disabled={Boolean(updatingId) || group.items.every((item) => item.synthetic)} className="flex h-10 items-center gap-2 rounded-lg border border-slate-200 px-4 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">{updatingId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clock3 className="h-4 w-4" />}标记已跟进</button>}
                          <button type="button" onClick={() => setRepushing(group)} disabled={!group.repushItem || recommendations.length === 0} className="flex h-10 items-center gap-2 rounded-lg bg-violet-600 px-4 text-sm font-medium text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"><Repeat2 className="h-4 w-4" />再次匹配并复推</button>
                        </div>
                      </div>
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>

      {repushing?.repushItem && (
        <RepushModal
          item={repushing.repushItem}
          existingItems={items}
          jds={jds}
          initialCategory={repushing.items.map((item) => inferCategory(item.jobTitle, jds)).find(Boolean)}
          excludeRecommended
          resultLimit={10}
          onClose={() => setRepushing(null)}
          onConfirm={confirmRepush}
        />
      )}
    </div>
  );
}
