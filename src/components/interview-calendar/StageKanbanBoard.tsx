'use client';
import { StageKanbanColumn } from './StageKanbanColumn';
import { DEFAULT_STAGES } from '@/types/interview';
import type { Candidate, CandidateOwner } from '@/types/interview';
import { getOfferPerformanceMonth } from '@/lib/offer-compensation';

interface StageKanbanBoardProps {
  candidates: Candidate[];
  owner: CandidateOwner;
  onCandidateClick: (id: string) => void;
  onFailCandidate: (id: string) => void;
  onDeleteCandidate: (id: string) => void;
  onEarlyDeparture: (id: string) => void;
  onDeleteOffer: (id: string) => void;
  onCommissionTenureChange: (id: string, months: 0 | 1 | 2 | 3) => void;
}

export function StageKanbanBoard({ candidates, owner, onCandidateClick, onFailCandidate, onDeleteCandidate, onEarlyDeparture, onDeleteOffer, onCommissionTenureChange }: StageKanbanBoardProps) {
  const interviewStages = DEFAULT_STAGES.filter((stage) => stage.id !== 'offer');
  const offerStage = DEFAULT_STAGES.find((stage) => stage.id === 'offer');
  const offerGroups = groupRecentOffers(candidates);

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
            onDeleteCandidate={onDeleteCandidate}
            onEarlyDeparture={onEarlyDeparture} />
        );
      })}
      {offerStage && offerGroups.map(({ month, candidates: monthCandidates }) => (
        <StageKanbanColumn
          key={month}
          stage={offerStage}
          title={`${Number(month.slice(5))}月 Offer`}
          subtitle="按入职满月进度发放"
          performanceMonth={month}
          owner={owner}
          candidates={monthCandidates}
          onCandidateClick={onCandidateClick}
          onFailCandidate={onFailCandidate}
          onEarlyDeparture={onEarlyDeparture}
          onDeleteOffer={onDeleteOffer}
          onCommissionTenureChange={onCommissionTenureChange}
        />
      ))}
    </div>
  );
}

function offerMonth(candidate: Candidate): string {
  const value = candidate.onboardDate || candidate.offerAppliedAt || candidate.appliedAt;
  return getOfferPerformanceMonth(value);
}

function groupRecentOffers(candidates: Candidate[]): Array<{ month: string; candidates: Candidate[] }> {
  const groups = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    if (candidate.stage !== 'offer') continue;
    const month = offerMonth(candidate);
    if (!month || month < '2026-09') continue;
    groups.set(month, [...(groups.get(month) || []), candidate]);
  }
  return Array.from(groups.entries())
    .sort(([left], [right]) => right.localeCompare(left))
    .slice(0, 3)
    .map(([month, values]) => ({
      month,
      candidates: sortCandidatesByDate(values, (candidate) => candidate.onboardDate || candidate.offerAppliedAt, true),
    }));
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
