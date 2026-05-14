'use client';
import { RadarChart, PolarGrid, PolarAngleAxis, Radar, PolarRadiusAxis, ResponsiveContainer } from 'recharts';
import type { ScoreBreakdown } from '@/types/matching';

interface ScoreRadarChartProps { breakdown: ScoreBreakdown; size?: number; }

export function ScoreRadarChart({ breakdown, size = 160 }: ScoreRadarChartProps) {
  const data = [
    { dimension: '技能', score: breakdown.skillsMatch, fullMark: 100 },
    { dimension: '经验', score: breakdown.experienceMatch, fullMark: 100 },
    { dimension: '教育', score: breakdown.educationMatch, fullMark: 100 },
    { dimension: '综合', score: breakdown.overallFit, fullMark: 100 },
  ];
  return (
    <ResponsiveContainer width="100%" height={size}>
      <RadarChart data={data} cx="50%" cy="50%" outerRadius="65%">
        <PolarGrid stroke="#e5e7eb" />
        <PolarAngleAxis dataKey="dimension" tick={{ fill: '#9ca3af', fontSize: 11 }} />
        <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
        <Radar dataKey="score" stroke="#6366f1" fill="#6366f1" fillOpacity={0.2} strokeWidth={2} />
      </RadarChart>
    </ResponsiveContainer>
  );
}
