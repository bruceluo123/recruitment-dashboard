'use client';
import type { WheelEvent } from 'react';
import { cn } from '@/lib/utils';
import { StageKanbanCard } from './StageKanbanCard';
import { STAGE_COLORS } from '@/types/interview';
import type { InterviewStage, Candidate } from '@/types/interview';

interface StageKanbanColumnProps {
  stage: InterviewStage;
  candidates: Candidate[];
  onCandidateClick: (candidateId: string) => void;
  onDeleteCandidate: (id: string) => void;
}

export function StageKanbanColumn({ stage, candidates, onCandidateClick, onDeleteCandidate }: StageKanbanColumnProps) {
  const dotColor = STAGE_COLORS[stage.id] || 'bg-gray-400';
  // Offer 列徽标展示「所有 Offer 分数的总和」（可能含小数，保留 1 位去尾零）；其余列展示候选人数
  const isOffer = stage.id === 'offer';
  const scoreSum = candidates.reduce((sum, c) => sum + (c.score || 0), 0);
  const badgeValue = isOffer ? Number(scoreSum.toFixed(1)) : candidates.length;
  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    if (event.currentTarget.scrollWidth <= event.currentTarget.clientWidth) return;
    event.preventDefault();
    event.currentTarget.scrollLeft += event.deltaY;
  };

  return (
    <section className="grid min-h-[202px] grid-cols-[132px_minmax(0,1fr)] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex flex-col justify-between border-r border-gray-100 bg-gray-50 px-4 py-4">
        <div>
          <div className="flex items-center gap-2">
            <div className={cn('w-2.5 h-2.5 rounded-full', dotColor)} />
            <h3 className="text-sm font-semibold text-gray-700">{stage.name}</h3>
          </div>
          <p className="mt-2 text-[11px] leading-4 text-gray-400">滚轮横向浏览</p>
        </div>
        <span className="w-fit rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-sm font-bold tabular-nums text-gray-700">
          {badgeValue}{isOffer && <span className="ml-0.5 text-[10px] font-medium text-gray-400">分</span>}
        </span>
      </div>
      <div onWheel={handleWheel} className="flex min-w-0 gap-3 overflow-x-auto overflow-y-hidden p-3">
        {candidates.length > 0 ? candidates.map((c) => (
          <StageKanbanCard key={c.id} candidate={c} onClick={() => onCandidateClick(c.id)} onDelete={onDeleteCandidate} />
        )) : (
          <div className="flex min-w-[220px] items-center justify-center text-xs text-gray-400">暂无候选人</div>
        )}
      </div>
    </section>
  );
}
