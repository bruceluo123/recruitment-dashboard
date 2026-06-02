import type { Talent } from '@/types/talent';
import type { ScoreBreakdown } from '@/types/matching';

// 「一个 JD → 多个候选人」匹配结果（人才库匹配入口专用）
export interface TalentMatchResult {
  id: string;
  talentId: string;
  talent: Talent;
  score: number;
  breakdown: ScoreBreakdown;
  reasoning: string;
  highlights: string[];
  concerns: string[];
  matchedAt: string;
}

// 匹配入口接受的精简 JD（库内 JD 或粘贴文本均归一为此）
export interface MatchJDInput {
  title: string;
  department?: string;
  location?: string;
  salaryText?: string;
  responsibilities: string[];
  requirements: string[];
}
