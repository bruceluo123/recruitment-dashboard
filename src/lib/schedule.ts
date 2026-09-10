// 约面：把一条推荐记录写入面试日历（创建候选人），并把关联信息写回推荐记录。
// 推荐中心与本周推荐两个页面共用，避免逻辑重复。

import type { JD } from '@/types/jd';
import type { Candidate, InterviewEvent } from '@/types/interview';
import type { RepushItem, InterviewRound } from '@/store/repush-store';
import { matchJDByTitle } from './recommendation';
import { generateId } from './utils';

// 轮次 → 看板阶段。看板只有一面/二面/Offer 三列，三面归入二面列，轮次另存于推荐记录。
const ROUND_TO_STAGE: Record<InterviewRound, Candidate['stage']> = {
  一面: 'interview-1',
  二面: 'interview-2',
  三面: 'interview-2',
};

interface ScheduleArgs {
  interviewAt: string;       // datetime-local 字符串
  interviewer: string;
  round: InterviewRound;
}

interface ScheduleDeps {
  jds: JD[];
  candidates: Candidate[];
  addCandidate: (c: Omit<Candidate, 'id' | 'appliedAt' | 'updatedAt'>) => string;
  updateCandidate: (id: string, partial: Partial<Candidate>) => void;
  updateItem: (id: string, partial: Partial<RepushItem>) => void;
}

export function findRecommendationCandidate(item: RepushItem, candidates: Candidate[]): Candidate | undefined {
  const norm = (value?: string) => String(value || '').trim().toLowerCase();
  const name = item.candidateName || item.fileName.replace(/\.(pdf|docx?)$/i, '').trim();
  const matches = candidates.filter((candidate) => (candidate.owner || 'a') === item.column
    && (item.candidateCode ? norm(candidate.candidateCode) === norm(item.candidateCode) : norm(candidate.name) === norm(name))
    && norm(candidate.jdTitle) === norm(item.jdTitle)
    && norm(candidate.organization) === norm(item.organization)
    && norm(candidate.department) === norm(item.department));
  return matches.find((candidate) => candidate.id === item.candidateId) || (matches.length === 1 ? matches[0] : undefined);
}

export function reconcileScheduledRecommendations(items: RepushItem[], candidates: Candidate[]): { items: RepushItem[]; changed: boolean } {
  let changed = false;
  const reconciled = items.map((item) => {
    const linkedCandidate = findRecommendationCandidate(item, candidates);

    if (!linkedCandidate?.interviewDate) return item;
    const round: InterviewRound = linkedCandidate.interviewRound
      || (linkedCandidate.stage === 'interview-1' ? '一面' : '二面');
    if (
      item.interviewStatus === 'scheduled'
      && item.candidateId === linkedCandidate.id
      && item.interviewAt === linkedCandidate.interviewDate
      && item.interviewRound === round
    ) return item;

    changed = true;
    return {
      ...item,
      interviewStatus: 'scheduled' as const,
      candidateId: linkedCandidate.id,
      interviewAt: linkedCandidate.interviewDate,
      interviewRound: round,
      updatedAt: new Date().toISOString(),
    };
  });
  return { items: reconciled, changed };
}

export function scheduleRecommendation(item: RepushItem, args: ScheduleArgs, deps: ScheduleDeps): void {
  const { interviewAt, interviewer, round } = args;
  const { jds, candidates, addCandidate, updateCandidate, updateItem } = deps;
  if (!interviewAt) return;

  const name = item.candidateName || item.fileName.replace(/\.(pdf|docx?)$/i, '').trim();
  const jdTitle = item.jdTitle || '';
  const jd = jdTitle ? matchJDByTitle(jdTitle, jds) : null;
  const isoAt = new Date(interviewAt).toISOString();
  const scheduledAt = new Date().toISOString();
  const organization = item.organization || jd?.organization?.trim() || undefined;
  const department = item.department || jd?.department?.trim() || undefined;

  const linkedCandidate = findRecommendationCandidate(item, candidates);
  const legacyHistory: InterviewEvent[] = linkedCandidate?.interviewDate && !linkedCandidate.interviewHistory?.length
    ? [{
      id: `legacy-${linkedCandidate.id}`,
      round: linkedCandidate.interviewRound || (linkedCandidate.stage === 'interview-1' ? '一面' : '二面'),
      interviewDate: linkedCandidate.interviewDate,
      scheduledAt: linkedCandidate.interviewScheduledAt || linkedCandidate.appliedAt,
      interviewer: linkedCandidate.interviewer,
    }]
    : [];
  const history = [...(linkedCandidate?.interviewHistory || legacyHistory)];
  const previousEvent = [...history].reverse().find((event) => (
    (event.recommendationId === item.id && event.round === round)
    || (!event.recommendationId && linkedCandidate?.interviewRound === round)
  ));
  history.push({
    id: generateId(),
    recommendationId: item.id,
    eventType: previousEvent ? 'rescheduled' : 'scheduled',
    previousEventId: previousEvent?.id,
    previousInterviewDate: previousEvent?.interviewDate,
    round,
    interviewDate: isoAt,
    // 每次改期都是独立事件，原约面记录与其统计周期均保留。
    scheduledAt,
    interviewer: interviewer.trim() || linkedCandidate?.interviewer || undefined,
  });
  const partial: Partial<Candidate> = {
    owner: item.column,
    candidateCode: item.candidateCode || linkedCandidate?.candidateCode,
    stage: ROUND_TO_STAGE[round],
    interviewRound: round,
    interviewHistory: history,
    interviewDate: isoAt,
    interviewScheduledAt: scheduledAt,
    interviewer: interviewer.trim() || linkedCandidate?.interviewer || undefined,
    organization: organization || linkedCandidate?.organization,
    department: department || linkedCandidate?.department,
    workMode: linkedCandidate?.workMode || (jd?.location?.trim() && !/remote|远程|居家/i.test(jd.location) ? '到岗' : '远程'),
    recommendationSource: item.source || linkedCandidate?.recommendationSource || 'intake',
  };

  let candidateId = linkedCandidate?.id;
  if (linkedCandidate) {
    updateCandidate(linkedCandidate.id, partial);
  } else {
    candidateId = addCandidate({
      name,
      resumeId: '',
      jdId: jd?.id || '',
      jdTitle,
      resumeUrl: item.resumeUrl || undefined,
      resumeFileName: item.resumeFileName || undefined,
      talentId: item.talentId || undefined,
      score: 0,
      contactPhone: item.contact || undefined,
      ...partial,
      stage: ROUND_TO_STAGE[round],
    });
  }

  updateItem(item.id, { interviewStatus: 'scheduled', candidateId, interviewAt: isoAt, interviewRound: round });
}
