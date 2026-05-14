import type { JD } from './jd';

export interface ScoreBreakdown {
  skillsMatch: number;
  experienceMatch: number;
  educationMatch: number;
  overallFit: number;
}

export interface MatchingResult {
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
