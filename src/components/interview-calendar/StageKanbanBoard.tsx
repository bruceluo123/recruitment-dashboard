'use client';
import { StageKanbanColumn } from './StageKanbanColumn';
import { DEFAULT_STAGES } from '@/types/interview';
import type { Candidate, CandidateStatus } from '@/types/interview';

interface StageKanbanBoardProps {
  candidates: Candidate[];
  onCandidateMove: (id: string, toStage: CandidateStatus) => void;
  onCandidateClick: (id: string) => void;
  onDeleteCandidate: (id: string) => void;
  onAddCandidate: (stage: CandidateStatus) => void;
}

export function StageKanbanBoard({ candidates, onCandidateMove, onCandidateClick, onDeleteCandidate, onAddCandidate }: StageKanbanBoardProps) {
  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {DEFAULT_STAGES.map((stage) => {
        const stageCandidates = candidates.filter((c) => c.stage === stage.id);
        // Offer 列按入职时间(onboardDate)从前到后排；其余列按面试时间排
        const sorted = stage.id === 'offer'
          ? sortCandidatesByDate(stageCandidates, (c) => c.onboardDate)
          : sortCandidatesByDate(stageCandidates, (c) => c.interviewDate);
        return (
          <StageKanbanColumn key={stage.id} stage={stage}
            candidates={sorted}
            onCandidateMove={onCandidateMove} onCandidateClick={onCandidateClick}
            onDeleteCandidate={onDeleteCandidate} onAddCandidate={onAddCandidate} />
        );
      })}
    </div>
  );
}

function sortCandidatesByDate(candidates: Candidate[], getDate: (c: Candidate) => string | undefined): Candidate[] {
  return [...candidates].sort((a, b) => toTime(getDate(a)) - toTime(getDate(b)));
}

function toTime(dateStr: string | undefined): number {
  if (!dateStr) return Number.MAX_SAFE_INTEGER;
  const time = new Date(dateStr).getTime();
  return Number.isNaN(time) ? Number.MAX_SAFE_INTEGER : time;
}
