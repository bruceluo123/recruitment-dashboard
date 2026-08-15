'use client';
import { useState } from 'react';
import { CalendarClock, CircleX, LogOut, Mail, Pencil, UserRound } from 'lucide-react';
import { cn, formatInterviewDate } from '@/lib/utils';
import type { Candidate, CandidateStatus } from '@/types/interview';
import { OUTCOME_LABELS, OUTCOME_COLORS } from '@/types/interview';

interface StageKanbanCardProps {
  candidate: Candidate;
  onClick: () => void;
  onFail: (id: string) => void;
  onEarlyDeparture: (id: string) => void;
}

const STAGE_ACCENTS: Record<CandidateStatus, { border: string; badge: string; icon: string }> = {
  'interview-1': { border: 'border-l-blue-400', badge: 'bg-blue-50 text-blue-600', icon: 'text-blue-500' },
  'interview-2': { border: 'border-l-amber-400', badge: 'bg-amber-50 text-amber-700', icon: 'text-amber-500' },
  offer: { border: 'border-l-emerald-400', badge: 'bg-emerald-50 text-emerald-700', icon: 'text-emerald-500' },
};

/** 入职时间为日期字段，按「X月X号(周X)」展示，不显示时间。 */
function formatOnboardDate(isoStr: string): string {
  const date = new Date(isoStr);
  if (Number.isNaN(date.getTime())) return isoStr;
  const week = ['日', '一', '二', '三', '四', '五', '六'][date.getDay()];
  return `${date.getMonth() + 1}月${date.getDate()}号(周${week})`;
}

function getScoreColor(score: number): string {
  if (score <= 5) {
    if (score >= 4) return 'text-emerald-600';
    if (score >= 3) return 'text-amber-600';
    return 'text-rose-500';
  }
  if (score >= 80) return 'text-emerald-600';
  if (score >= 60) return 'text-amber-600';
  return 'text-rose-500';
}

export function StageKanbanCard({ candidate, onClick, onFail, onEarlyDeparture }: StageKanbanCardProps) {
  const [confirming, setConfirming] = useState(false);
  const accent = STAGE_ACCENTS[candidate.stage];
  const showScore = candidate.stage === 'offer' || candidate.score > 0;
  const roundLabel = candidate.interviewRound || (candidate.stage === 'interview-1' ? '一面' : candidate.stage === 'interview-2' ? '二面' : '');

  return (
    <div
      onClick={onClick}
      className={cn(
        'group relative flex h-[158px] w-[270px] shrink-0 cursor-pointer flex-col rounded-md border border-l-[3px] border-gray-200 bg-white px-4 py-3 shadow-sm transition-all hover:-translate-y-0.5 hover:border-gray-300 hover:shadow-md animate-fade-in',
        accent.border,
      )}
    >
      <div className="mb-1.5 flex items-start justify-between">
        <div className="flex min-w-0 items-center gap-2 pr-2">
          <h4 className="truncate text-sm font-semibold text-gray-900">{candidate.name}</h4>
          {roundLabel && <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium', accent.badge)}>{roundLabel}</span>}
          {candidate.outcome && (
            <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium', OUTCOME_COLORS[candidate.outcome])}>
              {OUTCOME_LABELS[candidate.outcome]}
            </span>
          )}
        </div>
        {showScore && (
          <span className="flex shrink-0 items-baseline gap-0.5 leading-none">
            <span className={cn('text-base font-extrabold tabular-nums', getScoreColor(candidate.score))}>{candidate.score}</span>
            <span className="text-[10px] font-medium text-gray-400">分</span>
          </span>
        )}
      </div>

      <p className="mb-2 truncate text-xs text-gray-500">{candidate.jdTitle}</p>

      <div className="space-y-1.5">
        {candidate.onboardDate ? (
          <div className="flex items-center gap-1.5 text-xs">
            <CalendarClock className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
            <span className="shrink-0 text-gray-400">入职</span>
            <span className="truncate font-semibold text-gray-800">{formatOnboardDate(candidate.onboardDate)}</span>
          </div>
        ) : candidate.interviewDate ? (
          <div className="flex items-center gap-1.5 text-xs">
            <CalendarClock className={cn('h-3.5 w-3.5 shrink-0', accent.icon)} />
            <span className="truncate font-semibold text-gray-800">{formatInterviewDate(candidate.interviewDate)}</span>
          </div>
        ) : null}

        <div className="flex min-w-0 items-center gap-3">
          {candidate.salary && <span className="shrink-0 text-xs font-semibold text-emerald-600">{candidate.salary}</span>}
          {candidate.interviewer && (
            <span className="flex min-w-0 items-center gap-1 text-xs text-gray-500">
              <UserRound className="h-3 w-3 shrink-0" />
              <span className="truncate">{candidate.interviewer}</span>
            </span>
          )}
        </div>
        {candidate.contactEmail && (
          <p className="flex items-center gap-1 text-xs text-gray-400">
            <Mail className="h-3 w-3 shrink-0" />
            <span className="truncate">{candidate.contactEmail}</span>
          </p>
        )}
      </div>

      <div className="mt-auto flex items-center justify-between border-t border-gray-100 pt-2">
        <span className="flex items-center gap-1 text-[11px] text-gray-400 transition-colors group-hover:text-indigo-500">
          <Pencil className="h-3 w-3" />查看详情
        </span>
        {candidate.stage === 'offer' ? (
          <button
            title="记录提前离职"
            onClick={(event) => { event.stopPropagation(); onEarlyDeparture(candidate.id); }}
            className="flex items-center gap-1 rounded-md bg-rose-50 px-2 py-1 text-[11px] font-medium text-rose-500 transition-all hover:bg-rose-100"
          >
            <LogOut className="h-3.5 w-3.5" />提前离职
          </button>
        ) : candidate.outcome === 'failed' ? (
          <span className="flex items-center gap-1 rounded-md bg-red-50 px-2 py-1 text-[11px] font-medium text-red-500">
            <CircleX className="h-3.5 w-3.5" />未通过
          </span>
        ) : confirming ? (
          <div className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
            <button onClick={(event) => { event.stopPropagation(); onFail(candidate.id); setConfirming(false); }} className="h-6 rounded-md bg-red-500 px-2 text-[11px] font-medium text-white hover:bg-red-600">确认未通过</button>
            <button onClick={(event) => { event.stopPropagation(); setConfirming(false); }} className="h-6 rounded-md px-2 text-[11px] text-gray-500 hover:bg-gray-100">取消</button>
          </div>
        ) : (
          <button title="标记面试未通过" onClick={(event) => { event.stopPropagation(); setConfirming(true); }} className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-gray-400 transition-all hover:bg-red-50 hover:text-red-500">
            <CircleX className="h-3.5 w-3.5" />未通过
          </button>
        )}
      </div>
    </div>
  );
}
