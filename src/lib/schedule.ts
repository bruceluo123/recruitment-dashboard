// 约面：把一条推荐记录写入面试日历（创建候选人），并把关联信息写回推荐记录。
// 推荐中心与本周推荐两个页面共用，避免逻辑重复。

import type { JD } from '@/types/jd';
import type { Candidate } from '@/types/interview';
import type { RepushItem, InterviewRound } from '@/store/repush-store';
import { matchJDByTitle } from './recommendation';

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

export function reconcileScheduledRecommendations(items: RepushItem[], candidates: Candidate[]): { items: RepushItem[]; changed: boolean } {
  let changed = false;
  const reconciled = items.map((item) => {
    const name = item.candidateName || item.fileName.replace(/\.(pdf|docx?)$/i, '').trim();
    const linkedCandidate = candidates.find((candidate) => candidate.id === item.candidateId)
      || candidates.find((candidate) => (
        (candidate.owner || 'a') === item.column
        && candidate.name === name
        && candidate.jdTitle === (item.jdTitle || '')
      ));

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

  const linkedCandidate = candidates.find((candidate) => candidate.id === item.candidateId)
    || candidates.find((candidate) => (candidate.owner || 'a') === item.column && candidate.name === name && candidate.jdTitle === jdTitle);
  const partial: Partial<Candidate> = {
    owner: item.column,
    stage: ROUND_TO_STAGE[round],
    interviewRound: round,
    interviewDate: isoAt,
    interviewScheduledAt: new Date().toISOString(),
    interviewer: interviewer.trim() || linkedCandidate?.interviewer || undefined,
    organization: item.organization || linkedCandidate?.organization || jd?.organization?.trim() || undefined,
    department: item.department || linkedCandidate?.department || jd?.department?.trim() || undefined,
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
