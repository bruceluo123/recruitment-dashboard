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
  addCandidate: (c: Omit<Candidate, 'id' | 'appliedAt' | 'updatedAt'>) => string;
  updateItem: (id: string, partial: Partial<RepushItem>) => void;
}

export function scheduleRecommendation(item: RepushItem, args: ScheduleArgs, deps: ScheduleDeps): void {
  const { interviewAt, interviewer, round } = args;
  const { jds, addCandidate, updateItem } = deps;
  if (!interviewAt) return;

  const name = item.candidateName || item.fileName.replace(/\.(pdf|docx?)$/i, '').trim();
  const jdTitle = item.jdTitle || '';
  const jd = jdTitle ? matchJDByTitle(jdTitle, jds) : null;
  const isoAt = new Date(interviewAt).toISOString();

  const candidateId = addCandidate({
    name,
    resumeId: '',
    jdId: jd?.id || '',
    jdTitle,
    owner: item.column,  // 约面来源列（a=麦满分 / b=啵啵）带入候选人
    // 简历资产全链路：推荐记录里的简历文件/人才关联跟随候选人进入面试日历
    resumeUrl: item.resumeUrl || undefined,
    resumeFileName: item.resumeFileName || undefined,
    talentId: item.talentId || undefined,
    organization: item.organization || jd?.organization?.trim() || undefined,
    department: item.department || jd?.department?.trim() || undefined,
    stage: ROUND_TO_STAGE[round],
    score: 0,
    interviewDate: isoAt,
    interviewer: interviewer.trim() || undefined,
    contactPhone: item.contact || undefined,
    notes: round === '三面' ? '三面' : undefined,
  });

  updateItem(item.id, { interviewStatus: 'scheduled', candidateId, interviewAt: isoAt, interviewRound: round });
}
