export type CandidateStatus = 'applied' | 'interview' | 'offer';

export interface InterviewStage { id: CandidateStatus; name: string; order: number; color: string; }

export interface Candidate {
  id: string;
  name: string;
  resumeId: string;
  jdId: string;
  jdTitle: string;
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
  { id: 'applied', name: '已投递', order: 0, color: 'blue' },
  { id: 'interview', name: '面试', order: 1, color: 'amber' },
  { id: 'offer', name: 'Offer', order: 2, color: 'green' },
];

export const STAGE_COLORS: Record<string, string> = {
  applied: 'bg-blue-500',
  interview: 'bg-amber-500',
  offer: 'bg-green-500',
};
