export type CandidateStatus = 'interview-1' | 'interview-2' | 'offer';

export interface InterviewStage { id: CandidateStatus; name: string; order: number; color: string; }

export interface Candidate {
  id: string;
  name: string;
  resumeId: string;
  jdId: string;
  jdTitle: string;
  organization?: string;   // 编制组织（取自 JD 库）
  department?: string;     // 部门（取自 JD 库）
  stage: CandidateStatus;
  score: number;
  interviewDate?: string;
  interviewer?: string;
  notes?: string;
  contactEmail?: string;
  contactPhone?: string;
  salary?: string;
  onboardDate?: string;
  appliedAt: string;
  updatedAt: string;
}

export const DEFAULT_STAGES: InterviewStage[] = [
  { id: 'interview-1', name: '面试一面', order: 0, color: 'blue' },
  { id: 'interview-2', name: '二面', order: 1, color: 'amber' },
  { id: 'offer', name: 'Offer', order: 2, color: 'green' },
];

export const STAGE_COLORS: Record<string, string> = {
  'interview-1': 'bg-blue-500',
  'interview-2': 'bg-amber-500',
  offer: 'bg-green-500',
};
