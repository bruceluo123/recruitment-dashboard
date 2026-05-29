import type { JD } from './jd';

export interface ScoreBreakdown {
  skillsMatch: number;      // 技能/工具匹配
  experienceMatch: number;  // 经验/项目匹配
  domainMatch: number;      // 行业/方向匹配
  seniorityMatch: number;   // 职级/薪资匹配
  overallFit: number;       // 综合
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
