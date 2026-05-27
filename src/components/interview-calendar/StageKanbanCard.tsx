'use client';
import { cn, formatInterviewDate } from '@/lib/utils';
import type { Candidate } from '@/types/interview';
import { STAGE_COLORS } from '@/types/interview';
import { Mail, Trash2 } from 'lucide-react';

interface StageKanbanCardProps { candidate: Candidate; onClick: () => void; onDelete: (id: string) => void; }

export function StageKanbanCard({ candidate, onClick, onDelete }: StageKanbanCardProps) {
  const scoreColor = candidate.score >= 80 ? 'text-green-600' : candidate.score >= 60 ? 'text-amber-600' : 'text-red-600';
  const dotColor = STAGE_COLORS[candidate.stage] || 'bg-gray-400';

  return (
    <div draggable onDragStart={(e) => { e.dataTransfer.setData('candidateId', candidate.id); e.currentTarget.classList.add('opacity-50'); }} onDragEnd={(e) => { e.currentTarget.classList.remove('opacity-50'); }} onClick={onClick}
      className="bg-white hover:bg-gray-50 border border-gray-200 hover:border-gray-300 rounded-xl p-3.5 cursor-pointer transition-all group animate-fade-in shadow-sm">
      <div className="flex items-start justify-between mb-2">
        <h4 className="text-sm font-medium text-gray-800 truncate pr-2">{candidate.name}</h4>
        <span className={cn('text-xs font-bold shrink-0', scoreColor)}>{candidate.score}</span>
      </div>
      <p className="text-xs text-gray-400 mb-3 truncate">{candidate.jdTitle}</p>
      <div className="space-y-1.5">
        {candidate.salary && (
          <p className="text-xs text-green-600 font-medium">{candidate.salary}</p>
        )}
        {candidate.interviewDate && (
          <div className="flex items-center gap-1.5">
            <div className={cn('w-1.5 h-1.5 rounded-full shrink-0', dotColor)} />
            <span className="text-sm font-bold text-gray-800">{formatInterviewDate(candidate.interviewDate)}</span>
          </div>
        )}
        {candidate.interviewer && <p className="text-xs text-gray-500">面试官: {candidate.interviewer}</p>}
        {candidate.contactEmail && <p className="text-xs text-gray-400 flex items-center gap-1"><Mail className="w-3 h-3" /><span className="truncate">{candidate.contactEmail}</span></p>}
      </div>
      <div className="mt-2 pt-2 border-t border-gray-100 flex items-center justify-between">
        <span className="text-xs text-gray-400 group-hover:text-gray-500 transition-colors">拖拽移动</span>
        <button onClick={(e) => { e.stopPropagation(); onDelete(candidate.id); }} className="p-1 rounded hover:bg-red-50 text-gray-300 hover:text-red-500 transition-all opacity-0 group-hover:opacity-100">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
