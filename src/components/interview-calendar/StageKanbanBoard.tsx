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
  const interviewStages = DEFAULT_STAGES.filter((stage) => stage.id !== 'offer');
  const offerStage = DEFAULT_STAGES.find((stage) => stage.id === 'offer');
  const offerCandidates = candidates.filter((candidate) => candidate.stage === 'offer');
  const augustOffers = sortCandidatesByDate(
    offerCandidates.filter((candidate) => isAugustPerformanceOffer(candidate.onboardDate)),
    (candidate) => candidate.onboardDate,
    true,
  );
  const septemberOffers = sortCandidatesByDate(
    offerCandidates.filter((candidate) => !isAugustPerformanceOffer(candidate.onboardDate)),
    (candidate) => candidate.onboardDate,
    true,
  );

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
      {interviewStages.map((stage) => {
        const stageCandidates = candidates.filter((c) => c.stage === stage.id);
        const sorted = sortCandidatesByDate(stageCandidates, (c) => c.interviewDate);
        return (
          <StageKanbanColumn key={stage.id} stage={stage}
            candidates={sorted}
            onCandidateClick={onCandidateClick}
            onFailCandidate={onFailCandidate}
            onEarlyDeparture={onEarlyDeparture} />
        );
      })}
      {offerStage && (
        <>
          <StageKanbanColumn
            stage={offerStage}
            title="9月 Offer"
            subtitle="8/26起"
            candidates={septemberOffers}
            onCandidateClick={onCandidateClick}
            onFailCandidate={onFailCandidate}
            onEarlyDeparture={onEarlyDeparture}
          />
          <StageKanbanColumn
            stage={offerStage}
            title="8月 Offer"
            subtitle="7/26-8/25"
            candidates={augustOffers}
            onCandidateClick={onCandidateClick}
            onFailCandidate={onFailCandidate}
            onEarlyDeparture={onEarlyDeparture}
          />
        </>
      )}
    </div>
  );
}

function isAugustPerformanceOffer(onboardDate: string | undefined): boolean {
  if (!onboardDate) return false;
  const date = onboardDate.slice(0, 10);
  return date >= '2026-07-26' && date <= '2026-08-25';
}

function sortCandidatesByDate(
  candidates: Candidate[],
  getDate: (c: Candidate) => string | undefined,
  newestFirst = false,
): Candidate[] {
  return [...candidates].sort((a, b) => {
    const aTime = toTime(getDate(a));
    const bTime = toTime(getDate(b));
    if (aTime === Number.MAX_SAFE_INTEGER) return bTime === Number.MAX_SAFE_INTEGER ? 0 : 1;
    if (bTime === Number.MAX_SAFE_INTEGER) return -1;
    return newestFirst ? bTime - aTime : aTime - bTime;
  });
}

function toTime(dateStr: string | undefined): number {
  if (!dateStr) return Number.MAX_SAFE_INTEGER;
  const time = new Date(dateStr).getTime();
  return Number.isNaN(time) ? Number.MAX_SAFE_INTEGER : time;
}
