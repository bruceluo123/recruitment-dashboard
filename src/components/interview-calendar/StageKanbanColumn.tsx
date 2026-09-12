'use client';
import { useRef } from 'react';
import type { WheelEvent } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { StageKanbanCard } from './StageKanbanCard';
import { STAGE_COLORS } from '@/types/interview';
import type { InterviewStage, Candidate, CandidateStatus } from '@/types/interview';
import { formatCommissionAmount, getCommissionPayout, getMonthlyCommissionRate, getOfferCommissionForCandidate, isEffectiveOnboard } from '@/lib/offer-compensation';

interface StageKanbanColumnProps {
  stage: InterviewStage;
  candidates: Candidate[];
  title?: string;
  subtitle?: string;
  onCandidateClick: (candidateId: string) => void;
  onFailCandidate: (id: string) => void;
  onEarlyDeparture: (id: string) => void;
  onDeleteOffer?: (id: string) => void;
  onCommissionTenureChange?: (id: string, months: 0 | 1 | 2 | 3) => void;
}

const LANE_TONES: Record<CandidateStatus, string> = {
  'interview-1': 'bg-blue-50/70',
  'interview-2': 'bg-amber-50/70',
  offer: 'bg-emerald-50/70',
};

export function StageKanbanColumn({ stage, candidates, title, subtitle, onCandidateClick, onFailCandidate, onEarlyDeparture, onDeleteOffer, onCommissionTenureChange }: StageKanbanColumnProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dotColor = STAGE_COLORS[stage.id] || 'bg-gray-400';
  const isOffer = stage.id === 'offer';
  const commissions = isOffer
    ? new Map(candidates.map((candidate) => [candidate.id, getOfferCommissionForCandidate(candidate, candidates)]))
    : new Map();
  const commissionSum = Array.from(commissions.values()).reduce((sum, item) => sum + (item?.commissionAmount || 0), 0);
  const payableSum = isOffer
    ? candidates.reduce((sum, candidate) => sum + getCommissionPayout(commissions.get(candidate.id), candidate.commissionTenureMonths || 0).amount, 0)
    : 0;
  const effectiveOnboards = isOffer ? candidates.filter(isEffectiveOnboard) : [];
  const commissionRate = getMonthlyCommissionRate(effectiveOnboards.length);
  const advancedOnboardCount = effectiveOnboards.filter((candidate) => {
    const tier = commissions.get(candidate.id)?.salaryTier;
    const advancedTitle = /高级|资深|主管|经理|负责人|专家|总监|架构|首席|\blead(?:er)?\b|\bhead\b|\bprincipal\b|\bstaff\b/i.test(candidate.jdTitle);
    return advancedTitle || tier === '高级/主管/经理' || tier === '专家/总监' || tier === '特殊人才/CEO';
  }).length;
  const headerSubtitle = isOffer
    ? [subtitle, `入职 ${effectiveOnboards.length} 人`, `高级岗位 ${advancedOnboardCount} 人`].filter(Boolean).join(' · ')
    : subtitle;

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    if (event.currentTarget.scrollWidth <= event.currentTarget.clientWidth) return;
    event.preventDefault();
    event.currentTarget.scrollLeft += event.deltaY;
  };

  const scrollTrack = (direction: number) => {
    trackRef.current?.scrollBy({ left: direction * 560, behavior: 'smooth' });
  };

  return (
    <section className="border-b border-gray-200 last:border-b-0">
      <header className={cn('flex h-12 items-center justify-between border-b border-gray-100 px-4', LANE_TONES[stage.id])}>
        <div className="flex min-w-0 items-center gap-3">
          <div className={cn('h-2.5 w-2.5 shrink-0 rounded-full ring-4 ring-white/80', dotColor)} />
          <h3 className="text-sm font-semibold text-gray-800">{title || stage.name}</h3>
          {headerSubtitle && <span className="text-xs text-gray-400">{headerSubtitle}</span>}
          <span className="rounded-md border border-white bg-white/90 px-2 py-0.5 text-xs font-semibold tabular-nums text-gray-600 shadow-sm">
            {isOffer ? `${candidates.length} 个 Offer` : candidates.length}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" title="向左浏览" onClick={() => scrollTrack(-1)} className="flex h-7 w-7 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-white hover:text-gray-700">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button type="button" title="向右浏览" onClick={() => scrollTrack(1)} className="flex h-7 w-7 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-white hover:text-gray-700">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </header>
      {isOffer && (
        <div className="grid grid-cols-2 gap-px border-b border-emerald-100 bg-emerald-100 sm:grid-cols-4">
          <CommissionStat label="有效入职" value={`${effectiveOnboards.length} 人`} hint={`高级岗位 ${advancedOnboardCount} 人`} />
          <CommissionStat label="人数档比例" value={`${commissionRate * 100}%`} hint={effectiveOnboards.length < 3 ? '不足3人，暂不计提' : '同月所有Offer联动'} />
          <CommissionStat label="预计总提成" value={`¥${formatCommissionAmount(commissionSum)}`} hint="转正薪资 × 比例 × 难度系数" />
          <CommissionStat label="当前累计可发" value={`¥${formatCommissionAmount(payableSum)}`} hint="按入职满月进度计算" />
        </div>
      )}
      <div ref={trackRef} onWheel={handleWheel} className="flex h-[182px] min-w-0 gap-3 overflow-x-auto overflow-y-hidden bg-[#fbfcfe] px-4 py-3 scroll-smooth">
        {candidates.length > 0 ? candidates.map((candidate) => (
          <StageKanbanCard
            key={candidate.id}
            candidate={candidate}
            offerCommission={commissions.get(candidate.id) || undefined}
            onClick={() => onCandidateClick(candidate.id)}
            onFail={onFailCandidate}
            onEarlyDeparture={onEarlyDeparture}
            onDeleteOffer={onDeleteOffer}
            onCommissionTenureChange={onCommissionTenureChange}
          />
        )) : (
          <div className="flex w-full items-center justify-center text-xs text-gray-400">暂无候选人</div>
        )}
      </div>
    </section>
  );
}

function CommissionStat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="bg-emerald-50/60 px-4 py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-medium text-emerald-700/70">{label}</span>
        <span className="text-sm font-bold tabular-nums text-emerald-700">{value}</span>
      </div>
      <p className="mt-0.5 truncate text-[10px] text-gray-400" title={hint}>{hint}</p>
    </div>
  );
}
