'use client';
import { cn } from '@/lib/utils';
import { StageKanbanCard } from './StageKanbanCard';
import { STAGE_COLORS } from '@/types/interview';
import type { InterviewStage, Candidate, CandidateStatus } from '@/types/interview';
import { Plus } from 'lucide-react';

interface StageKanbanColumnProps {
  stage: InterviewStage;
  candidates: Candidate[];
  onCandidateMove: (candidateId: string, toStage: CandidateStatus) => void;
  onCandidateClick: (candidateId: string) => void;
  onDeleteCandidate: (id: string) => void;
  onAddCandidate: (stage: CandidateStatus) => void;
}

export function StageKanbanColumn({ stage, candidates, onCandidateMove, onCandidateClick, onDeleteCandidate, onAddCandidate }: StageKanbanColumnProps) {
  const dotColor = STAGE_COLORS[stage.id] || 'bg-gray-400';
  // Offer 列徽标展示「所有 Offer 分数的总和」（可能含小数，保留 1 位去尾零）；其余列展示候选人数
  const isOffer = stage.id === 'offer';
  const scoreSum = candidates.reduce((sum, c) => sum + (c.score || 0), 0);
  const badgeValue = isOffer ? Number(scoreSum.toFixed(1)) : candidates.length;

  return (
    <div className="flex-shrink-0 w-[280px] flex flex-col" onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('bg-indigo-50/50'); }} onDragLeave={(e) => { e.currentTarget.classList.remove('bg-indigo-50/50'); }} onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove('bg-indigo-50/50'); const candidateId = e.dataTransfer.getData('candidateId'); if (candidateId) onCandidateMove(candidateId, stage.id); }}>
      <div className="flex items-center justify-between px-3 py-3 sticky top-0 bg-gray-50/80 backdrop-blur-sm z-10 rounded-t-xl">
        <div className="flex items-center gap-2">
          <div className={cn('w-2.5 h-2.5 rounded-full', dotColor)} />
          <h3 className="text-sm font-semibold text-gray-700">{stage.name}</h3>
        </div>
        <span className="text-sm font-bold text-gray-700 tabular-nums bg-white px-2.5 py-0.5 rounded-lg border border-gray-200">
          {badgeValue}{isOffer && <span className="ml-0.5 text-[10px] font-medium text-gray-400">分</span>}
        </span>
      </div>
      <div className="flex-1 px-2 pb-4 space-y-2 overflow-y-auto min-h-[200px]">
        {candidates.map((c) => <StageKanbanCard key={c.id} candidate={c} onClick={() => onCandidateClick(c.id)} onDelete={onDeleteCandidate} />)}
        <button onClick={() => onAddCandidate(stage.id)} className="w-full flex items-center justify-center gap-1 py-3 border-2 border-dashed border-gray-200 rounded-xl text-xs text-gray-400 hover:text-gray-600 hover:border-gray-300 transition-all">
          <Plus className="w-3.5 h-3.5" />添加候选人
        </button>
      </div>
    </div>
  );
}
