'use client';
import { cn, formatSalary } from '@/lib/utils';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { ScoreRadarChart } from './ScoreRadarChart';
import { JD_CATEGORY_LABELS, JD_CATEGORY_COLORS, PRIORITY_COLORS, isUrgentPriority } from '@/types/jd';
import type { MatchingResult } from '@/types/matching';
import { ChevronRight, AlertTriangle, ThumbsUp, FileText, Sparkles, ExternalLink, UserRound, Copy, Check } from 'lucide-react';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useJDStore } from '@/store/jd-store';

interface MatchingResultCardProps { result: MatchingResult; rank: number; }

export function MatchingResultCard({ result, rank }: MatchingResultCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [viewMode, setViewMode] = useState<'ai' | 'jd' | 'odc'>('ai');
  const [odcCopied, setOdcCopied] = useState(false);
  const [jdCopied, setJdCopied] = useState(false);
  const { jd, score, breakdown, reasoning, highlights, concerns } = result;
  const scoreColor = score >= 80 ? 'text-green-600' : score >= 60 ? 'text-amber-600' : 'text-red-600';
  const router = useRouter();
  const selectJD = useJDStore((s) => s.selectJD);

  const handleViewDetail = () => {
    selectJD(jd.id);
    router.push('/jd-library');
  };

  const handleCopyJd = async () => {
    const text = `${jd.title}\n\n岗位职责：\n${jd.responsibilities.map((r, i) => `${i + 1}. ${r}`).join('\n')}\n\n岗位需求：\n${jd.requirements.map((r, i) => `${i + 1}. ${r}`).join('\n')}`;
    try {
      await navigator.clipboard.writeText(text);
      setJdCopied(true);
      setTimeout(() => setJdCopied(false), 1500);
    } catch { /* clipboard 不可用时忽略 */ }
  };

  const handleCopyOdc = async () => {
    if (!jd.odc) return;
    try {
      await navigator.clipboard.writeText(jd.odc);
      setOdcCopied(true);
      setTimeout(() => setOdcCopied(false), 1500);
    } catch { /* clipboard 不可用时忽略 */ }
  };

  return (
    <GlassPanel padding="md" hover className="cursor-pointer" onClick={() => setExpanded(!expanded)}>
      <div className="flex items-start gap-4">
        <div className="flex flex-col items-center shrink-0">
          <span className="text-xs text-gray-400 mb-1">#{rank}</span>
          <div className="relative w-14 h-14 flex items-center justify-center">
            <svg className="absolute inset-0 w-14 h-14 -rotate-90">
              <circle cx="28" cy="28" r="24" fill="none" stroke="#e5e7eb" strokeWidth="3" />
              <circle cx="28" cy="28" r="24" fill="none" stroke={score >= 80 ? '#10b981' : score >= 60 ? '#f59e0b' : '#ef4444'} strokeWidth="3" strokeDasharray={`${score * 1.51} 151`} strokeLinecap="round" />
            </svg>
            <span className={cn('text-lg font-bold', scoreColor)}>{score}</span>
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h4 className="text-base font-semibold text-gray-800">{jd.title}</h4>
                {isUrgentPriority(jd.priority) && (
                  <span className={cn('px-1.5 py-0.5 rounded-md text-xs font-bold', PRIORITY_COLORS[jd.priority!])}>急招 {jd.priority}</span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span className={cn('px-2 py-0.5 rounded-md text-xs font-medium', JD_CATEGORY_COLORS[jd.categories[0]])}>{JD_CATEGORY_LABELS[jd.categories[0]]}</span>
                <span className="text-xs text-gray-400">{jd.department}</span>
                <span className="text-xs text-green-600">{formatSalary(jd.salaryRange, jd.salaryText)}</span>
                <button onClick={(e) => { e.stopPropagation(); handleCopyJd(); }}
                  className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium transition-colors',
                    jdCopied ? 'bg-green-50 text-green-600' : 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100')}>
                  {jdCopied ? <><Check className="w-3 h-3" />已复制</> : <><Copy className="w-3 h-3" />复制 JD</>}
                </button>
              </div>
            </div>
            <ChevronRight className={cn('w-5 h-5 text-gray-300 shrink-0 transition-all', expanded && 'rotate-90')} />
          </div>
          {expanded && (
            <div className="mt-4 pt-4 border-t border-gray-100 animate-fade-in space-y-4" onClick={(e) => e.stopPropagation()}>
              {/* View toggle */}
              <div className="flex items-center gap-1 p-1 bg-gray-100 rounded-lg">
                <button onClick={() => setViewMode('ai')}
                  className={cn('flex-1 py-2 rounded-md text-xs font-medium transition-all flex items-center justify-center gap-1.5',
                    viewMode === 'ai' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700')}>
                  <Sparkles className="w-3.5 h-3.5" />AI 分析
                </button>
                <button onClick={() => setViewMode('jd')}
                  className={cn('flex-1 py-2 rounded-md text-xs font-medium transition-all flex items-center justify-center gap-1.5',
                    viewMode === 'jd' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700')}>
                  <FileText className="w-3.5 h-3.5" />原文 JD
                </button>
                <button onClick={handleViewDetail}
                  className="flex-1 py-2 rounded-md text-xs font-medium transition-all flex items-center justify-center gap-1.5 text-gray-500 hover:text-indigo-600 hover:bg-white hover:shadow-sm">
                  <ExternalLink className="w-3.5 h-3.5" />查看详情
                </button>
                <button onClick={() => setViewMode(viewMode === 'odc' ? 'ai' : 'odc')}
                  className={cn('flex-1 py-2 rounded-md text-xs font-medium transition-all flex items-center justify-center gap-1.5',
                    viewMode === 'odc' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700')}>
                  <UserRound className="w-3.5 h-3.5" />对接 ODC
                </button>
              </div>

              {viewMode === 'odc' && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-gray-400">对接 ODC</p>
                  {jd.odc ? (
                    <button onClick={handleCopyOdc}
                      className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-left transition-colors group">
                      <span className="text-sm font-medium text-gray-800">{jd.odc}</span>
                      {odcCopied
                        ? <span className="flex items-center gap-1 text-xs text-green-600"><Check className="w-3.5 h-3.5" />已复制</span>
                        : <span className="flex items-center gap-1 text-xs text-indigo-500 opacity-0 group-hover:opacity-100 transition-opacity"><Copy className="w-3.5 h-3.5" />点击复制</span>}
                    </button>
                  ) : (
                    <p className="text-sm text-gray-400 px-3 py-2.5 rounded-lg bg-gray-50">暂无 ODC 信息</p>
                  )}
                </div>
              )}

              {viewMode === 'ai' && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <ScoreRadarChart breakdown={breakdown} size={160} />
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-2">
                        {[{ label: '技能', v: breakdown.skillsMatch }, { label: '经验', v: breakdown.experienceMatch }, { label: '方向', v: breakdown.domainMatch }, { label: '职级', v: breakdown.seniorityMatch }, { label: '综合', v: breakdown.overallFit }].map((d) => (
                          <div key={d.label} className="p-2 rounded-lg bg-gray-50"><p className="text-xs text-gray-400">{d.label}</p><p className={cn('text-sm font-bold', d.v >= 80 ? 'text-green-600' : d.v >= 60 ? 'text-amber-600' : 'text-red-600')}>{d.v}</p></div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <p className="text-sm text-gray-600 leading-relaxed">{reasoning}</p>
                  {highlights.length > 0 && (
                    <div className="space-y-1.5"><p className="text-xs font-medium text-green-600 flex items-center gap-1.5"><ThumbsUp className="w-3.5 h-3.5" />匹配亮点</p>{highlights.map((h, i) => <p key={i} className="text-sm text-gray-600 pl-5">• {h}</p>)}</div>
                  )}
                  {concerns.length > 0 && (
                    <div className="space-y-1.5"><p className="text-xs font-medium text-amber-600 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" />潜在顾虑</p>{concerns.map((c, i) => <p key={i} className="text-sm text-gray-500 pl-5">• {c}</p>)}</div>
                  )}
                </>
              )}

              {viewMode === 'jd' && (
                <div className="space-y-4">
                  <div>
                    <h4 className="text-sm font-semibold text-gray-800 mb-2">岗位职责</h4>
                    <ul className="space-y-1.5">
                      {jd.responsibilities.map((r, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                          <span className="w-4 h-4 rounded-full bg-indigo-100 text-indigo-600 text-xs flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                          {r}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-gray-800 mb-2">岗位要求</h4>
                    <ul className="space-y-1.5">
                      {jd.requirements.map((r, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                          <span className="w-4 h-4 rounded-full bg-amber-100 text-amber-600 text-xs flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                          {r}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-gray-400">
                    <span>部门: {jd.department || '-'}</span>
                    <span>地点: {jd.location || 'remote'}</span>
                    <span>薪资: {formatSalary(jd.salaryRange, jd.salaryText)}</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </GlassPanel>
  );
}
