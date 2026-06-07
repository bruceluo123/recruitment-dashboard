'use client';
import { Check, X, CalendarPlus, CalendarCheck, Phone, UserCog } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { RepushItem } from '@/store/repush-store';
import { displayName, formatRecommendTime } from '@/lib/repush-format';

interface FeedbackBarProps {
  item: RepushItem;
  onSetFeedback: (id: string, feedback: 'done' | 'pending') => void;
  onSchedule: (item: RepushItem) => void;
}

export function FeedbackBar({ item, onSetFeedback, onSchedule }: FeedbackBarProps) {
  const base = displayName(item);
  const orgDept = [item.organization, item.department].filter(Boolean).join(' · ');

  return (
    <div className={cn(
      'flex items-center gap-4 px-4 py-3 rounded-2xl border bg-white transition-all',
      item.feedback === 'done' ? 'border-green-100' : 'border-gray-100 hover:border-indigo-200',
    )}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-gray-800 truncate">{base}</span>
          {item.interviewRound && (
            <span className="px-1.5 py-0.5 rounded-md bg-green-50 text-green-600 text-[11px] font-medium shrink-0">{item.interviewRound}</span>
          )}
        </div>
        <div className="mt-1 flex items-center gap-x-3 gap-y-0.5 flex-wrap text-xs text-gray-400">
          {orgDept && <span className="text-indigo-500">{orgDept}</span>}
          {item.contact && <span className="flex items-center gap-0.5"><Phone className="w-3 h-3" />{item.contact}</span>}
          {item.contactPerson && <span className="flex items-center gap-0.5"><UserCog className="w-3 h-3" />对接 {item.contactPerson}</span>}
          <span className="text-gray-400">{formatRecommendTime(item.uploadedAt)}</span>
        </div>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {item.interviewStatus === 'scheduled' ? (
          <button
            onClick={() => onSchedule(item)}
            className="flex items-center gap-1 px-2.5 h-8 rounded-lg text-xs font-medium border border-green-200 bg-green-50 text-green-600 hover:bg-green-100 transition-colors"
            title="已约面，点击可改期"
          >
            <CalendarCheck className="w-3.5 h-3.5" />已约面
          </button>
        ) : (
          <button
            onClick={() => onSchedule(item)}
            className="flex items-center gap-1 px-2.5 h-8 rounded-lg text-xs font-medium border border-indigo-200 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition-colors"
            title="约面并同步面试日历"
          >
            <CalendarPlus className="w-3.5 h-3.5" />约面
          </button>
        )}
        <div className="flex items-center gap-1 pl-1 border-l border-gray-100">
          <button
            onClick={() => onSetFeedback(item.id, 'done')}
            className={cn('p-1.5 rounded-lg transition-all', item.feedback === 'done' ? 'bg-green-100 text-green-600' : 'text-gray-300 hover:text-green-500 hover:bg-green-50')}
            title="已反馈"
          >
            <Check className="w-4 h-4" />
          </button>
          <button
            onClick={() => onSetFeedback(item.id, 'pending')}
            className={cn('p-1.5 rounded-lg transition-all', item.feedback === 'pending' ? 'bg-red-100 text-red-500' : 'text-gray-300 hover:text-red-500 hover:bg-red-50')}
            title="未反馈"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
