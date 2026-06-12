'use client';
import { useState } from 'react';
import { cn, formatInterviewDate } from '@/lib/utils';
import type { Candidate } from '@/types/interview';
import { STAGE_COLORS } from '@/types/interview';
import { Mail, Trash2 } from 'lucide-react';

interface StageKanbanCardProps { candidate: Candidate; onClick: () => void; onDelete: (id: string) => void; }

/** 入职时间为「日期」字段（无具体时刻），按「X月X号(周X)」展示，不显示时间。 */
function formatOnboardDate(isoStr: string): string {
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return isoStr;
  const week = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
  return `${d.getMonth() + 1}月${d.getDate()}号(周${week})`;
}

export function StageKanbanCard({ candidate, onClick, onDelete }: StageKanbanCardProps) {
  const [confirming, setConfirming] = useState(false);
  const scoreColor = candidate.score >= 80 ? 'text-green-600' : candidate.score >= 60 ? 'text-amber-600' : 'text-red-600';
  const dotColor = STAGE_COLORS[candidate.stage] || 'bg-gray-400';
  // 一面/二面阶段尚未评分时（0 分）不显示分数，避免满屏「0 分」；Offer 阶段始终显示
  const showScore = candidate.stage === 'offer' || candidate.score > 0;

  return (
    <div draggable onDragStart={(e) => { e.dataTransfer.setData('candidateId', candidate.id); e.currentTarget.classList.add('opacity-50'); }} onDragEnd={(e) => { e.currentTarget.classList.remove('opacity-50'); }} onClick={onClick}
      className="bg-white hover:bg-gray-50 border border-gray-200 hover:border-gray-300 rounded-xl p-3.5 cursor-pointer transition-all group animate-fade-in shadow-sm">
      <div className="flex items-start justify-between mb-2">
        <h4 className="text-sm font-medium text-gray-800 truncate pr-2">{candidate.name}</h4>
        {showScore && (
          <span className="shrink-0 flex items-baseline gap-0.5 leading-none">
            <span className={cn('text-xl font-extrabold tabular-nums', scoreColor)}>{candidate.score}</span>
            <span className="text-[10px] font-medium text-gray-400">分</span>
          </span>
        )}
      </div>
      <p className="text-xs text-gray-400 mb-3 truncate">{candidate.jdTitle}</p>
      <div className="space-y-1.5">
        {candidate.salary && (
          <p className="text-xs text-green-600 font-medium">{candidate.salary}</p>
        )}
        {/* 优先展示入职时间；无入职时间时回退到面试时间，避免面试阶段卡片无日期 */}
        {candidate.onboardDate ? (
          <div className="flex items-center gap-1.5">
            <div className={cn('w-1.5 h-1.5 rounded-full shrink-0', dotColor)} />
            <span className="text-xs text-gray-400 shrink-0">入职</span>
            <span className="text-sm font-bold text-gray-800">{formatOnboardDate(candidate.onboardDate)}</span>
          </div>
        ) : candidate.interviewDate ? (
          <div className="flex items-center gap-1.5">
            <div className={cn('w-1.5 h-1.5 rounded-full shrink-0', dotColor)} />
            <span className="text-sm font-bold text-gray-800">{formatInterviewDate(candidate.interviewDate)}</span>
          </div>
        ) : null}
        {candidate.interviewer && <p className="text-xs text-gray-500">面试官: {candidate.interviewer}</p>}
        {candidate.contactEmail && <p className="text-xs text-gray-400 flex items-center gap-1"><Mail className="w-3 h-3" /><span className="truncate">{candidate.contactEmail}</span></p>}
      </div>
      <div className="mt-2 pt-2 border-t border-gray-100 flex items-center justify-between">
        <span className="text-xs text-gray-400 group-hover:text-gray-500 transition-colors">拖拽移动</span>
        {confirming ? (
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <button onClick={(e) => { e.stopPropagation(); onDelete(candidate.id); setConfirming(false); }} className="px-2 h-6 rounded-md text-[11px] font-medium bg-red-500 text-white hover:bg-red-600">确认删除</button>
            <button onClick={(e) => { e.stopPropagation(); setConfirming(false); }} className="px-2 h-6 rounded-md text-[11px] text-gray-500 hover:bg-gray-100">取消</button>
          </div>
        ) : (
          <button onClick={(e) => { e.stopPropagation(); setConfirming(true); }} className="p-1 rounded hover:bg-red-50 text-gray-300 hover:text-red-500 transition-all opacity-0 group-hover:opacity-100">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
