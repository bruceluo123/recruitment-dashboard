'use client';
import { useEffect, useState } from 'react';
import { Copy, Check, History, ClipboardList } from 'lucide-react';
import { FeedbackBar } from './FeedbackBar';
import { ScheduleModal } from './ScheduleModal';
import { EmptyState } from '@/components/ui/EmptyState';
import { useRepushStore, type RepushColumnId, type RepushItem, type InterviewRound } from '@/store/repush-store';
import { usePrefStore } from '@/store/pref-store';
import { useJDStore } from '@/store/jd-store';
import { useInterviewStore } from '@/store/interview-store';
import { scheduleRecommendation } from '@/lib/schedule';
import {
  buildUnfeedbackList, currentWeekKey, lastWeekKey, isInWeek, weekdayIndex, mondayOf,
} from '@/lib/repush-format';
import { cn } from '@/lib/utils';

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

/** 周一作为起点，取当前是周几（0=周一…6=周日）；周日(getDay=0)归为 6 */
function todayWeekday(): number {
  return (new Date().getDay() + 6) % 7;
}

export function RepushPoolPage() {
  const [mounted, setMounted] = useState(false);

  const items = useRepushStore((s) => s.items);
  const columnNames = useRepushStore((s) => s.columnNames);
  const updateItem = useRepushStore((s) => s.updateItem);
  const setFeedback = useRepushStore((s) => s.setFeedback);
  const recordUnfeedbackSnapshot = useRepushStore((s) => s.recordUnfeedbackSnapshot);
  const snapshots = useRepushStore((s) => s.unfeedbackSnapshots);

  const jds = useJDStore((s) => s.jds);
  const addCandidate = useInterviewStore((s) => s.addCandidate);

  const view = usePrefStore((s) => s.activeOwner);
  const setView = usePrefStore((s) => s.setActiveOwner);
  const [day, setDay] = useState<number>(todayWeekday());
  const [scheduling, setScheduling] = useState<RepushItem | null>(null);
  const [copied, setCopied] = useState<'' | 'this' | 'last'>('');

  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  const thisWeek = currentWeekKey();
  // 本周 + 当前推荐人的所有记录
  const weekItems = items.filter((it) => it.column === view && isInWeek(it.uploadedAt, thisWeek));
  // 选中某一天
  const dayItems = weekItems
    .filter((it) => weekdayIndex(it.uploadedAt) === day)
    .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());

  // 每天的记录数，用于天按钮角标
  const dayCounts = WEEKDAYS.map((_, i) => weekItems.filter((it) => weekdayIndex(it.uploadedAt) === i).length);
  const weekPending = weekItems.filter((it) => it.feedback === 'pending').length;

  const flash = (which: 'this' | 'last') => { setCopied(which); setTimeout(() => setCopied(''), 1800); };

  // 复制本周未反馈清单（当前推荐人），并记录快照
  const copyThisWeek = async () => {
    const text = buildUnfeedbackList(weekItems, `${columnNames[view]} 本周未反馈清单：`);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      recordUnfeedbackSnapshot({ weekKey: thisWeek, column: view, text });
      flash('this');
    } catch { /* 剪贴板不可用时静默忽略 */ }
  };

  // 复制上周未反馈清单：优先取已记录快照，否则用上周记录实时生成
  const copyLastWeek = async () => {
    const lastKey = lastWeekKey();
    const snap = snapshots.find((s) => s.weekKey === lastKey && s.column === view);
    let text = snap?.text || '';
    if (!text) {
      const lastItems = items.filter((it) => it.column === view && isInWeek(it.uploadedAt, lastKey));
      text = buildUnfeedbackList(lastItems, `${columnNames[view]} 上周未反馈清单：`);
    }
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      flash('last');
    } catch { /* 静默 */ }
  };

  const confirmSchedule = (args: { interviewAt: string; interviewer: string; round: InterviewRound }) => {
    if (!scheduling) return;
    scheduleRecommendation(scheduling, args, { jds, addCandidate, updateItem });
    setScheduling(null);
  };

  // 本周日期范围标题
  const mon = mondayOf(new Date());
  const sun = new Date(mon.getTime() + 6 * 24 * 60 * 60 * 1000);
  const rangeText = `${mon.getMonth() + 1}.${mon.getDate()} - ${sun.getMonth() + 1}.${sun.getDate()}`;

  return (
    <div className="flex flex-col h-full max-w-4xl mx-auto w-full">
      <div className="mb-5 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">本周推荐</h1>
          <p className="text-sm text-gray-400 mt-1">本周（{rangeText}）推荐反馈跟进，与推荐中心数据互通。</p>
        </div>
        {/* 两个推荐人切换（非并排） */}
        <div className="flex rounded-xl border border-gray-200 overflow-hidden text-sm shrink-0">
          {(['a', 'b'] as RepushColumnId[]).map((c) => (
            <button
              key={c}
              onClick={() => setView(c)}
              className={cn('px-4 h-9 font-medium transition-colors', view === c ? 'bg-indigo-500 text-white' : 'bg-white text-gray-500 hover:bg-indigo-50')}
            >
              {columnNames[c]}
            </button>
          ))}
        </div>
      </div>

      {/* 周一到周日切换 */}
      <div className="grid grid-cols-7 gap-2 mb-5">
        {WEEKDAYS.map((label, i) => {
          const active = day === i;
          const isToday = todayWeekday() === i;
          return (
            <button
              key={label}
              onClick={() => setDay(i)}
              className={cn(
                'relative flex flex-col items-center justify-center gap-0.5 h-16 rounded-xl border text-sm font-medium transition-all',
                active ? 'border-indigo-500 bg-indigo-500 text-white shadow-sm' : 'border-gray-200 bg-white text-gray-600 hover:border-indigo-300',
              )}
            >
              <span>{label}</span>
              <span className={cn('text-xs', active ? 'text-indigo-100' : 'text-gray-400')}>
                {dayCounts[i] > 0 ? `${dayCounts[i]} 人` : '—'}
              </span>
              {isToday && !active && <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-indigo-400" />}
            </button>
          );
        })}
      </div>

      {/* 未反馈清单操作 */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <button
          onClick={copyThisWeek}
          disabled={weekPending === 0}
          className={cn(
            'flex items-center gap-1.5 px-3 h-9 rounded-xl text-sm font-medium border transition-all',
            copied === 'this' ? 'border-green-200 bg-green-50 text-green-600'
              : weekPending === 0 ? 'border-gray-100 text-gray-300 cursor-not-allowed'
                : 'border-indigo-200 bg-indigo-50 text-indigo-600 hover:bg-indigo-100',
          )}
          title="复制本周全部未反馈推荐（已面试会标注几号）"
        >
          {copied === 'this' ? <Check className="w-4 h-4" /> : <ClipboardList className="w-4 h-4" />}
          {copied === 'this' ? '已复制' : `本周未反馈清单 ${weekPending}`}
        </button>
        <button
          onClick={copyLastWeek}
          className={cn(
            'flex items-center gap-1.5 px-3 h-9 rounded-xl text-sm font-medium border transition-all',
            copied === 'last' ? 'border-green-200 bg-green-50 text-green-600' : 'border-gray-200 text-gray-500 hover:bg-gray-50',
          )}
          title="复制上周未反馈清单（自动记录的快照）"
        >
          {copied === 'last' ? <Check className="w-4 h-4" /> : <History className="w-4 h-4" />}
          {copied === 'last' ? '已复制' : '上周未反馈'}
        </button>
        <span className="text-xs text-gray-400 ml-auto">{columnNames[view]} · {WEEKDAYS[day]} {dayItems.length} 人</span>
      </div>

      {/* 当天推荐数据条 */}
      <div className="flex-1 overflow-y-auto space-y-2">
        {dayItems.length > 0 ? (
          dayItems.map((it) => (
            <FeedbackBar key={it.id} item={it} onSetFeedback={setFeedback} onSchedule={setScheduling} />
          ))
        ) : (
          <EmptyState icon={Copy} title={`${WEEKDAYS[day]} 暂无推荐`} description="切换其它日期，或在推荐中心录入推荐人" />
        )}
      </div>

      {scheduling && (
        <ScheduleModal item={scheduling} onClose={() => setScheduling(null)} onConfirm={confirmSchedule} />
      )}
    </div>
  );
}
