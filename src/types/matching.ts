import type { JD } from './jd';

export interface CandidateAssessment {
  primaryRole: string;
  summary: string;
  levels: Array<{ label: string; quote: string }>;
  facts: Array<{ quote: string; meaning: string }>;
}

export interface ScoreBreakdown {
  skillsMatch: number;      // 技能/工具匹配
  experienceMatch: number;  // 经验/项目匹配
  domainMatch: number;      // 行业/方向匹配
  seniorityMatch: number;   // 职级/薪资匹配
  overallFit: number;       // 综合
}

export interface MatchingResult {
  levelFit?: 'close' | 'candidate_below_job' | 'job_below_candidate' | 'unknown';
  levelReason?: string;
  questions?: string[];
  assessmentStatus?: 'completed' | 'failed';
  assessmentSource?: 'local' | 'ai';
  matchTier?: 'direct' | 'review' | 'reject';
  categoryMatched?: boolean;
  matchedCoreTags?: string[];
  pendingCoreTags?: string[];
  policyScoreCap?: number;
  policyMatched?: string[];
  policyConcerns?: string[];
  cached?: boolean;
  evidence?: Array<{ quote: string; requirement: string; dimension: string }>;
  candidateLevels?: string[];
  id: string;
  jdId: string;
  jd: JD;
  resumeId: string;
  score: number;
  breakdown: ScoreBreakdown;
  reasoning: string;
  highlights: string[];
  concerns: string[];
  matchedAt: string;
}
