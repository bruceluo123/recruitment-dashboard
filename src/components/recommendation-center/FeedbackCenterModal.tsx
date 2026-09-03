'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  ClipboardCheck,
  Clock3,
  ExternalLink,
  Loader2,
  MessageSquareText,
  RefreshCw,
  Repeat,
  SearchCheck,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type {
  FeedbackCenterItem,
  FeedbackCenterState,
  FeedbackConfirmedStatus,
} from '@/types/feedback-center';

type TabId = 'pending' | 'screening_failed' | 'interview_failed';

interface FeedbackCenterModalProps {
  owner: 'a' | 'b';
  initialState?: FeedbackCenterState | null;
  onClose: () => void;
  onRepush: (recommendationId: string) => void;
}

const tabs: { id: TabId; label: string }[] = [
  { id: 'pending', label: '无反馈，去跟进' },
  { id: 'screening_failed', label: '已反馈，可复推' },
  { id: 'interview_failed', label: '面试后，可复推' },
];

const statusOptions: { value: FeedbackConfirmedStatus; label: string }[] = [
  { value: 'pending', label: '待反馈' },
  { value: 'screening_failed', label: '初筛未通过' },
  { value: 'interview_pending', label: '面试待反馈' },
  { value: 'interview_passed', label: '面试通过' },
  { value: 'interview_failed', label: '面试未通过' },
  { value: 'closed', label: '已关闭' },
];

function bucket(item: FeedbackCenterItem): TabId | 'closed' {
  const status = item.confirmedStatus;
  if (status) {
    if (status === 'closed' || status === 'interview_passed') return 'closed';
    if (status === 'interview_failed') return 'interview_failed';
    if (status === 'screening_failed') return 'screening_failed';
    if (status === 'interview_pending') return 'pending';
    return 'pending';
  }
  if (item.sourceStatus === 'interview_failed') return 'interview_failed';
  if (item.sourceStatus === 'screening_failed') return 'screening_failed';
  if (item.sourceStatus === 'manual_review') return 'pending';
  if (item.interviewStatus === '已约面') return 'pending';
  return 'pending';
}

function ageLabel(value?: string): string {
  if (!value) return '时间未知';
  const parsed = new Date(value.replace(' ', 'T'));
  if (Number.isNaN(parsed.getTime())) return value;
  const hours = Math.max(0, Math.floor((Date.now() - parsed.getTime()) / 3_600_000));
  if (hours < 24) return `${hours} 小时`;
  return `${Math.floor(hours / 24)} 天`;
}

function isWithinRecentDays(value?: string, days = 7): boolean {
  if (!value) return false;
  const parsed = new Date(value.replace(' ', 'T'));
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.getTime() >= Date.now() - days * 24 * 60 * 60 * 1000;
}

function candidateKey(item: FeedbackCenterItem): string {
  const code = item.candidateCode?.trim().toUpperCase();
  if (code) return `code:${code}`;
  return `name:${item.candidateName.trim().toLowerCase().replace(/\s+/g, '')}`;
}

function statusLabel(item: FeedbackCenterItem): string {
  if (item.confirmedStatus === 'interview_pending') return '面试待反馈';
  if (item.confirmedStatus === 'interview_passed') return '面试通过';
  if (item.confirmedStatus === 'closed') return '已关闭';
  const itemBucket = bucket(item);
  if (itemBucket === 'screening_failed') return '初筛未通过';
  if (itemBucket === 'interview_failed') return '面试未通过';
  return '待反馈';
}

function hasFeedback(item: FeedbackCenterItem): boolean {
  return bucket(item) !== 'pending';
}

export function FeedbackCenterModal({ owner, initialState, onClose, onRepush }: FeedbackCenterModalProps) {
  const hasInitialData = Boolean(initialState);
  const [state, setState] = useState<FeedbackCenterState>(initialState || { version: 1, generatedAt: '', items: [] });
  const [activeTab, setActiveTab] = useState<TabId>('pending');
  const [loading, setLoading] = useState(!hasInitialData);
  const [error, setError] = useState('');
  const [updatingId, setUpdatingId] = useState('');
  const [expandedId, setExpandedId] = useState('');

  const load = async (showBlockingLoader = state.items.length === 0) => {
    if (showBlockingLoader) setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/feedback-center', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || '反馈数据读取失败');
      setState({
        version: 1,
        generatedAt: data.generatedAt || '',
        items: Array.isArray(data.items) ? data.items : [],
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '反馈数据读取失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(!hasInitialData);
  }, []);

  const ownerItems = useMemo(
    () => state.items.filter((item) => item.owner === owner && isWithinRecentDays(item.recommendedAt)),
    [owner, state.items],
  );
  const candidateGroups = useMemo(() => {
    const grouped = new Map<string, FeedbackCenterItem[]>();
    ownerItems.forEach((item) => {
      const key = candidateKey(item);
      grouped.set(key, [...(grouped.get(key) || []), item]);
    });
    return Array.from(grouped.entries()).map(([key, items]) => ({
      key,
      items: items.sort((a, b) => String(b.recommendedAt || '').localeCompare(String(a.recommendedAt || ''))),
      latestAt: items.reduce((latest, item) => String(item.recommendedAt || '') > latest ? String(item.recommendedAt || '') : latest, ''),
    })).sort((a, b) => b.latestAt.localeCompare(a.latestAt));
  }, [ownerItems]);
  const counts = useMemo(() => tabs.reduce<Record<TabId, number>>((result, tab) => {
    result[tab.id] = candidateGroups.filter((group) => group.items.some((item) => bucket(item) === tab.id)).length;
    return result;
  }, {
    pending: 0,
    interview_failed: 0,
    screening_failed: 0,
  }), [candidateGroups]);
  const visibleGroups = useMemo(() => candidateGroups
    .filter((group) => group.items.some((item) => bucket(item) === activeTab)), [activeTab, candidateGroups]);
  const followUpTotal = counts.pending;

  const update = async (item: FeedbackCenterItem, body: object) => {
    setUpdatingId(item.id);
    setError('');
    try {
      const response = await fetch('/api/feedback-center', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, ...body }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || '反馈更新失败');
      setState((current) => ({
        ...current,
        items: current.items.map((entry) => entry.id === item.id ? data.item : entry),
      }));
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : '反馈更新失败');
    } finally {
      setUpdatingId('');
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 p-3" role="dialog" aria-modal="true" aria-label="反馈中心">
      <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
        <header className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h3 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
              <MessageSquareText className="h-5 w-5 text-indigo-500" />反馈待办
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              {loading && state.items.length === 0
                ? '正在整理待跟进名单...'
                : `最近 7 天投递：未反馈 ${followUpTotal} 人 · 已反馈可复推 ${counts.screening_failed} 人 · 面试后可复推 ${counts.interview_failed} 人。`}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => void load(false)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100" title="刷新">
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            </button>
            <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100" title="关闭">
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>

        <nav className="grid grid-cols-1 gap-2 border-b border-slate-100 px-5 py-3 sm:grid-cols-3">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => { setActiveTab(tab.id); setExpandedId(''); }}
              className={cn(
                'flex h-10 min-w-0 items-center justify-center gap-2 rounded-lg px-2 text-sm font-medium',
                activeTab === tab.id ? 'bg-indigo-50 text-indigo-600' : 'text-slate-500 hover:bg-slate-50',
              )}
            >
              {tab.label}
              <span className={cn(
                'rounded-md px-1.5 py-0.5 text-xs',
                activeTab === tab.id ? 'bg-white text-indigo-600' : 'bg-slate-100 text-slate-500',
              )}>{loading && state.items.length === 0 ? '...' : counts[tab.id]}</span>
            </button>
          ))}
        </nav>

        {error && <div className="mx-5 mt-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-2">
          {loading && state.items.length === 0 ? (
            <div className="flex h-56 items-center justify-center gap-2 text-sm text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin text-indigo-500" />正在读取反馈收件箱
            </div>
          ) : visibleGroups.length === 0 ? (
            <div className="flex h-56 flex-col items-center justify-center text-slate-400">
              <ClipboardCheck className="mb-2 h-8 w-8 text-emerald-400" />
              <p className="text-sm">这一栏已经处理完了</p>
            </div>
          ) : visibleGroups.map((group) => {
            const representative = group.items[0];
            const selectedItem = group.items.find((item) => item.id === expandedId);
            const feedbackCount = group.items.filter(hasFeedback).length;
            const pendingCount = group.items.length - feedbackCount;
            return (
              <section key={group.key} className="border-b border-slate-100 py-5 last:border-b-0">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {representative.candidateCode && <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-500">{representative.candidateCode}</span>}
                      <h4 className="text-base font-semibold text-slate-900">{representative.candidateName || '待确认候选人'}</h4>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                      <span>投递 {group.items.length} 个岗位</span>
                      <span className="flex items-center gap-1 text-emerald-600"><Check className="h-3.5 w-3.5" />已反馈 {feedbackCount}</span>
                      {pendingCount > 0 && <span className="flex items-center gap-1 font-medium text-amber-600"><Clock3 className="h-3.5 w-3.5" />待跟进 {pendingCount}</span>}
                    </div>
                  </div>
                  <span className="text-xs text-slate-400">最近推荐 {ageLabel(group.latestAt)}</span>
                </div>

                <div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(210px,1fr))] gap-2">
                  {group.items.map((item) => {
                    const itemBucket = bucket(item);
                    const received = hasFeedback(item);
                    const selected = expandedId === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setExpandedId(selected ? '' : item.id)}
                        className={cn(
                          'min-h-24 min-w-0 rounded-lg border p-3 text-left transition-colors',
                          selected && 'ring-2 ring-indigo-100',
                          itemBucket === 'pending'
                            ? 'border-amber-200 bg-amber-50/70 hover:bg-amber-50'
                            : 'border-slate-200 bg-white hover:border-emerald-200 hover:bg-emerald-50/30',
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="line-clamp-2 text-sm font-medium leading-5 text-slate-800">{item.jobTitle || '岗位待确认'}</span>
                          <span className={cn(
                            'flex shrink-0 items-center gap-1 text-xs font-medium',
                            received ? 'text-emerald-600' : 'text-amber-600',
                          )}>
                            {received ? <Check className="h-3.5 w-3.5" /> : <Clock3 className="h-3.5 w-3.5" />}
                            {statusLabel(item)}
                          </span>
                        </div>
                        <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-500">
                          {[item.organization, item.department].filter(Boolean).join(' / ') || '部门信息待确认'}
                        </p>
                        {item.contactPerson && <p className="mt-1 truncate text-xs text-slate-400">对接 {item.contactPerson}</p>}
                      </button>
                    );
                  })}
                </div>

                {selectedItem && (() => {
                  const updating = updatingId === selectedItem.id;
                  return (
                  <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-800">{selectedItem.jobTitle || '岗位待确认'}</p>
                        <p className="mt-1 text-xs leading-5 text-slate-500">{selectedItem.sourceSummary || selectedItem.auditConclusion || '近 7 天反馈截图中未找到明确结论'}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={selectedItem.confirmedStatus || ''}
                      onChange={(event) => event.target.value && void update(selectedItem, { action: 'status_update', status: event.target.value })}
                      disabled={updating}
                      className="h-9 min-w-32 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-600 outline-none focus:border-indigo-300"
                      aria-label="确认反馈状态"
                    >
                      <option value="">确认反馈</option>
                      {statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                    <button type="button" disabled={updating} onClick={() => void update(selectedItem, { action: 'follow_up' })} className="flex h-9 items-center gap-1.5 rounded-lg border border-indigo-200 bg-white px-3 text-sm font-medium text-indigo-600 hover:bg-indigo-50 disabled:opacity-50">
                      <Check className="h-4 w-4" />标记已跟进
                    </button>
                    {bucket(selectedItem) !== 'pending' && selectedItem.recommendationId && (
                      <button type="button" onClick={() => { void update(selectedItem, { action: 'repush' }); onRepush(selectedItem.recommendationId!); }} className="flex h-9 items-center gap-1.5 rounded-lg border border-violet-200 bg-white px-3 text-sm font-medium text-violet-600 hover:bg-violet-50">
                        <Repeat className="h-4 w-4" />
                        复推其他部门
                      </button>
                    )}
                      </div>
                    </div>
                    <div className="mt-3 grid gap-3 border-t border-slate-200 pt-3 text-sm text-slate-600 md:grid-cols-2">
                      <div>
                        <p className="text-xs font-medium text-slate-400">OCR 结论</p>
                        <p className="mt-1 leading-6">{selectedItem.auditConclusion || selectedItem.sourceSummary || '暂无摘要'}</p>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-slate-400">截图证据</p>
                        <p className="mt-1 leading-6">{selectedItem.sourceEvidence || '未提取到明确文字证据'}</p>
                        {selectedItem.telegramMessageId && <p className="mt-2 flex items-center gap-1 text-xs text-indigo-500"><ExternalLink className="h-3.5 w-3.5" />TG 消息 #{selectedItem.telegramMessageId}</p>}
                      </div>
                      {selectedItem.timeline.length > 0 && (
                        <div className="md:col-span-2">
                          <p className="text-xs font-medium text-slate-400">处理记录</p>
                          <p className="mt-1 text-xs leading-5 text-slate-500">
                            {selectedItem.timeline.slice(-5).map((event) => `${new Date(event.at).toLocaleString('zh-CN')} ${event.type === 'follow_up' ? '已跟进' : event.type === 'repush' ? '转复推' : event.status || '已更新'}`).join(' · ')}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                  );
                })()}
              </section>
            );
          })}
        </div>

        <footer className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-xs text-slate-400">
          <span>{state.generatedAt ? `最近识别：${new Date(state.generatedAt).toLocaleString('zh-CN')}` : '尚未同步 OCR 审计结果'}</span>
          <span className="flex items-center gap-1"><SearchCheck className="h-3.5 w-3.5" />确认后的状态优先于 OCR 判断</span>
        </footer>
      </div>
    </div>
  );
}
