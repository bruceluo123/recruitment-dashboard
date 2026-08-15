'use client';
import { StageKanbanColumn } from './StageKanbanColumn';
import { DEFAULT_STAGES } from '@/types/interview';
import type { Candidate } from '@/types/interview';

interface StageKanbanBoardProps {
  candidates: Candidate[];
  onCandidateClick: (id: string) => void;
  onFailCandidate: (id: string) => void;
  onEarlyDeparture: (id: string) => void;
}

export function StageKanbanBoard({ candidates, onCandidateClick, onFailCandidate, onEarlyDeparture }: StageKanbanBoardProps) {
  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
      {DEFAULT_STAGES.map((stage) => {
        const stageCandidates = candidates.filter((c) => c.stage === stage.id);
        // Offer 列按入职时间(onboardDate)从前到后排；其余列按面试时间排
        const sorted = stage.id === 'offer'
          ? sortCandidatesByDate(stageCandidates, (c) => c.onboardDate)
          : sortCandidatesByDate(stageCandidates, (c) => c.interviewDate);
        return (
          <StageKanbanColumn key={stage.id} stage={stage}
            candidates={sorted}
            onCandidateClick={onCandidateClick}
            onFailCandidate={onFailCandidate}
            onEarlyDeparture={onEarlyDeparture} />
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
