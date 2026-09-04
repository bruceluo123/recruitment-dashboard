export type CandidateStatus = 'interview-1' | 'interview-2' | 'offer';

/** 候选人最终结果（Offer 之后的闭环）。未设置=仍在流程中。 */
export type CandidateOutcome = 'onboarded' | 'offer-rejected' | 'failed' | 'withdrawn' | 'early-departure-30' | 'early-departure-7';

export const OUTCOME_LABELS: Record<CandidateOutcome, string> = {
  onboarded: '已入职',
  'offer-rejected': 'Offer被拒',
  failed: '未通过',
  withdrawn: '主动退出',
  'early-departure-30': '30天内离职',
  'early-departure-7': '7天内离职',
};

export const OUTCOME_COLORS: Record<CandidateOutcome, string> = {
  onboarded: 'bg-emerald-100 text-emerald-700 ring-1 ring-inset ring-emerald-300',
  'offer-rejected': 'bg-orange-100 text-orange-700 ring-1 ring-inset ring-orange-300',
  failed: 'bg-gray-100 text-gray-600 ring-1 ring-inset ring-gray-300',
  withdrawn: 'bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-300',
  'early-departure-30': 'bg-orange-100 text-orange-700 ring-1 ring-inset ring-orange-300',
  'early-departure-7': 'bg-red-100 text-red-700 ring-1 ring-inset ring-red-300',
};

export const ALL_OUTCOMES: CandidateOutcome[] = ['onboarded', 'offer-rejected', 'failed', 'withdrawn'];

/** 候选人归属的推荐人列：a=麦满分，b=啵啵（与复推池列一致）。未设置时按麦满分处理 */
export type CandidateOwner = 'a' | 'b';

export type InterviewRound = '一面' | '二面' | '三面';

/** 每次从推荐中心点击「面试」产生一条，避免二面覆盖一面的历史。 */
export interface InterviewEvent {
  id: string;
  recommendationId?: string;
  round: InterviewRound;
  interviewDate: string;
  scheduledAt: string;
  interviewer?: string;
}

export type OfferJobLevel = '初级' | '一级' | '二级' | '三级' | '四级' | '五级';

export interface InterviewStage { id: CandidateStatus; name: string; order: number; color: string; }

export interface Candidate {
  id: string;
  name: string;
  candidateCode?: string; // 候选人唯一编码，优先用于跨模块关联和报表合并
  resumeId: string;
  jdId: string;
  jdTitle: string;
  owner?: CandidateOwner;  // 归属推荐人列：a=麦满分 / b=啵啵（未设置按麦满分）
  organization?: string;   // 编制组织（取自 JD 库）
  department?: string;     // 部门（取自 JD 库）
  stage: CandidateStatus;
  interviewRound?: InterviewRound;
  interviewHistory?: InterviewEvent[]; // 所有约面操作历史；二面/改期不覆盖已有记录
  score: number;
  interviewDate?: string;
  interviewScheduledAt?: string; // 最近一次在推进中心确认约面的时间
  offerAppliedAt?: string;       // 在推荐中心确认 Offer 的时间，供日报按天统计
  interviewer?: string;
  notes?: string;
  contactEmail?: string;
  contactPhone?: string;
  salary?: string;
  probationSalary?: string;
  regularSalary?: string;
  probationMonths?: string;
  jobLevel?: OfferJobLevel;
  workMode?: string;
  recommendationSource?: 'intake' | 'repush';
  onboardDate?: string;
  outcome?: CandidateOutcome;   // 最终结果；未设置=仍在流程中
  outcomeReason?: string;       // 淘汰/退出原因，供复推决策参考
  outcomeAt?: string;           // 结果标记时间
  scoreBeforeEarlyDeparture?: number; // 提前离职扣分前的原始分数，切换或清除结果时用于恢复
  resumeUrl?: string;           // 简历文件 Blob 链接（从推荐记录带入，面试官可直接下载）
  resumeFileName?: string;      // 简历原始文件名
  talentId?: string;            // 关联人才库 id（跨模块主键）
  appliedAt: string;
  updatedAt: string;
}

export const DEFAULT_STAGES: InterviewStage[] = [
  { id: 'interview-1', name: '一面', order: 0, color: 'blue' },
  { id: 'interview-2', name: '二面 / 三面', order: 1, color: 'amber' },
  { id: 'offer', name: 'Offer', order: 2, color: 'green' },
];

export const STAGE_COLORS: Record<string, string> = {
  'interview-1': 'bg-blue-500',
  'interview-2': 'bg-amber-500',
  offer: 'bg-green-500',
};
