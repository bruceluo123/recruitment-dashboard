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
      {DEFAULT_STAGES.map((stage) => (
        <StageKanbanColumn key={stage.id} stage={stage}
          candidates={sortCandidatesByInterviewTime(candidates.filter((c) => c.stage === stage.id))}
          onCandidateMove={onCandidateMove} onCandidateClick={onCandidateClick}
          onDeleteCandidate={onDeleteCandidate} onAddCandidate={onAddCandidate} />
      ))}
    </div>
  );
}

function sortCandidatesByInterviewTime(candidates: Candidate[]): Candidate[] {
  return [...candidates].sort((a, b) => getInterviewTime(a) - getInterviewTime(b));
}

function getInterviewTime(candidate: Candidate): number {
  if (!candidate.interviewDate) return Number.MAX_SAFE_INTEGER;
  const time = new Date(candidate.interviewDate).getTime();
  return Number.isNaN(time) ? Number.MAX_SAFE_INTEGER : time;
}
