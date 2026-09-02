'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
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

type TabId = 'first' | 'second' | 'interview' | 'failed' | 'review';

interface FeedbackCenterModalProps {
  owner: 'a' | 'b';
  onClose: () => void;
  onRepush: (recommendationId: string) => void;
}

const tabs: { id: TabId; label: string }[] = [
  { id: 'first', label: '待首次跟进' },
  { id: 'second', label: '待二次跟进' },
  { id: 'interview', label: '面试待反馈' },
  { id: 'failed', label: '明确未通过' },
  { id: 'review', label: '待人工确认' },
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
    if (status === 'screening_failed' || status === 'interview_failed') return 'failed';
    if (status === 'interview_pending') return 'interview';
    return item.followUpCount > 0 ? 'second' : 'first';
  }
  if (item.sourceStatus === 'screening_failed' || item.sourceStatus === 'interview_failed') return 'failed';
  if (item.sourceStatus === 'manual_review') return 'review';
  if (item.interviewStatus === '已约面') return 'interview';
  return item.followUpCount > 0 ? 'second' : 'first';
}

function ageLabel(value?: string): string {
  if (!value) return '时间未知';
  const parsed = new Date(value.replace(' ', 'T'));
  if (Number.isNaN(parsed.getTime())) return value;
  const hours = Math.max(0, Math.floor((Date.now() - parsed.getTime()) / 3_600_000));
  if (hours < 24) return `${hours} 小时`;
  return `${Math.floor(hours / 24)} 天`;
}

export function FeedbackCenterModal({ owner, onClose, onRepush }: FeedbackCenterModalProps) {
  const [state, setState] = useState<FeedbackCenterState>({ version: 1, generatedAt: '', items: [] });
  const [activeTab, setActiveTab] = useState<TabId>('first');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [updatingId, setUpdatingId] = useState('');
  const [expandedId, setExpandedId] = useState('');

  const load = async () => {
    setLoading(true);
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
    void load();
  }, []);

  const ownerItems = useMemo(
    () => state.items.filter((item) => item.owner === owner),
    [owner, state.items],
  );
  const counts = useMemo(() => tabs.reduce<Record<TabId, number>>((result, tab) => {
    result[tab.id] = ownerItems.filter((item) => bucket(item) === tab.id).length;
    return result;
  }, { first: 0, second: 0, interview: 0, failed: 0, review: 0 }), [ownerItems]);
  const visibleItems = useMemo(() => ownerItems
    .filter((item) => bucket(item) === activeTab)
    .sort((a, b) => String(b.feedbackAt || b.recommendedAt || '').localeCompare(String(a.feedbackAt || a.recommendedAt || ''))), [activeTab, ownerItems]);

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
              <MessageSquareText className="h-5 w-5 text-indigo-500" />反馈中心
            </h3>
            <p className="mt-1 text-sm text-slate-400">OCR 只提供识别建议，确认后才进入正式跟进流程。沉默不会被判定为未通过。</p>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => void load()} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100" title="刷新">
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            </button>
            <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100" title="关闭">
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>

        <nav className="grid grid-cols-2 gap-1.5 border-b border-slate-100 px-5 py-3 sm:grid-cols-5">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex h-10 min-w-0 items-center justify-center gap-2 rounded-lg px-2 text-sm font-medium',
                activeTab === tab.id ? 'bg-indigo-50 text-indigo-600' : 'text-slate-500 hover:bg-slate-50',
              )}
            >
              {tab.label}
              <span className={cn(
                'rounded-md px-1.5 py-0.5 text-xs',
                activeTab === tab.id ? 'bg-white text-indigo-600' : 'bg-slate-100 text-slate-500',
              )}>{counts[tab.id]}</span>
            </button>
          ))}
        </nav>

        {error && <div className="mx-5 mt-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>}

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-2">
          {loading ? (
            <div className="flex h-56 items-center justify-center gap-2 text-sm text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin text-indigo-500" />正在读取反馈收件箱
            </div>
          ) : visibleItems.length === 0 ? (
            <div className="flex h-56 flex-col items-center justify-center text-slate-400">
              <ClipboardCheck className="mb-2 h-8 w-8 text-emerald-400" />
              <p className="text-sm">这一栏已经处理完了</p>
            </div>
          ) : visibleItems.map((item) => {
            const expanded = expandedId === item.id;
            const updating = updatingId === item.id;
            return (
              <section key={item.id} className="border-b border-slate-100 py-4 last:border-b-0">
                <div className="min-w-0">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      {item.candidateCode && <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-500">{item.candidateCode}</span>}
                      <h4 className="font-semibold text-slate-900">{item.candidateName || '待确认候选人'} · {item.jobTitle || '岗位待确认'}</h4>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">{[item.organization, item.department, item.contactPerson].filter(Boolean).join(' · ') || '部门信息待确认'}</p>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
                      <span className="flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" />推荐后 {ageLabel(item.recommendedAt)}</span>
                      <span>已跟进 {item.followUpCount || 0} 次</span>
                      {item.feedbackAt && <span>最近证据 {item.feedbackAt}</span>}
                    </div>
                    {(item.sourceSummary || item.auditConclusion) && <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-600">{item.sourceSummary || item.auditConclusion}</p>}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                    <select
                      value={item.confirmedStatus || ''}
                      onChange={(event) => event.target.value && void update(item, { action: 'status_update', status: event.target.value })}
                      disabled={updating}
                      className="h-9 min-w-32 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-600 outline-none focus:border-indigo-300"
                      aria-label="确认反馈状态"
                    >
                      <option value="">确认反馈</option>
                      {statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                    <button type="button" disabled={updating} onClick={() => void update(item, { action: 'follow_up' })} className="flex h-9 items-center gap-1.5 rounded-lg border border-indigo-200 px-3 text-sm font-medium text-indigo-600 hover:bg-indigo-50 disabled:opacity-50">
                      <Check className="h-4 w-4" />标记已跟进
                    </button>
                    {item.recommendationId && (
                      <button type="button" onClick={() => { void update(item, { action: 'repush' }); onRepush(item.recommendationId!); }} className="flex h-9 items-center gap-1.5 rounded-lg border border-violet-200 px-3 text-sm font-medium text-violet-600 hover:bg-violet-50">
                        <Repeat className="h-4 w-4" />转复推
                      </button>
                    )}
                    <button type="button" onClick={() => setExpandedId(expanded ? '' : item.id)} className="flex h-9 items-center gap-1 rounded-lg px-2 text-sm text-slate-500 hover:bg-slate-50 sm:ml-auto">
                      OCR 证据{expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {expanded && (
                  <div className="mt-3 grid gap-3 border-l-2 border-indigo-100 bg-slate-50/70 px-4 py-3 text-sm text-slate-600 md:grid-cols-2">
                    <div>
                      <p className="text-xs font-medium text-slate-400">OCR 结论</p>
                      <p className="mt-1 leading-6">{item.auditConclusion || item.sourceSummary || '暂无摘要'}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-slate-400">截图证据</p>
                      <p className="mt-1 leading-6">{item.sourceEvidence || '未提取到明确文字证据'}</p>
                      {item.telegramMessageId && <p className="mt-2 flex items-center gap-1 text-xs text-indigo-500"><ExternalLink className="h-3.5 w-3.5" />TG 消息 #{item.telegramMessageId}</p>}
                    </div>
                    {item.timeline.length > 0 && (
                      <div className="md:col-span-2">
                        <p className="text-xs font-medium text-slate-400">处理记录</p>
                        <p className="mt-1 text-xs leading-5 text-slate-500">
                          {item.timeline.slice(-5).map((event) => `${new Date(event.at).toLocaleString('zh-CN')} ${event.type === 'follow_up' ? '已跟进' : event.type === 'repush' ? '转复推' : event.status || '已更新'}`).join(' · ')}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </div>

        <footer className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-xs text-slate-400">
          <span>{state.generatedAt ? `最近识别：${new Date(state.generatedAt).toLocaleString('zh-CN')}` : '尚未同步 OCR 审计结果'}</span>
          <span className="flex items-center gap-1"><SearchCheck className="h-3.5 w-3.5" />人工确认优先于 OCR</span>
        </footer>
      </div>
    </div>
  );
}
