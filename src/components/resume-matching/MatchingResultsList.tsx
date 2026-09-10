'use client';
import { MatchingResultCard } from './MatchingResultCard';
import { Loader2, BarChart3, FileText } from 'lucide-react';
import type { MatchingResult } from '@/types/matching';
import { groupPriorityLabel } from '@/lib/group-priority';
import { useState } from 'react';

interface MatchingResultsListProps {
  results: MatchingResult[];
  isMatching: boolean;
  refinementProgress?: { completed: number; total: number } | null;
  selectedResultIds: Set<string>;
  recommendationSelectionCount: number;
  generatedJdIds: Set<string>;
  isGeneratingCopy: boolean;
  onToggleSelected: (resultId: string) => void;
  onGenerateRecommendationCopy: () => void;
  onOpenRecommendationCopy: (jdId: string) => void;
}

export function MatchingResultsList({
  results,
  isMatching,
  refinementProgress,
  selectedResultIds,
  recommendationSelectionCount,
  generatedJdIds,
  isGeneratingCopy,
  onToggleSelected,
  onGenerateRecommendationCopy,
  onOpenRecommendationCopy,
}: MatchingResultsListProps) {
  const [sortMode, setSortMode] = useState<'score' | 'priority'>('score');
  const [tierFilter, setTierFilter] = useState<'all' | 'actionable' | 'direct' | 'review' | 'reject' | 'failed'>('all');
  const [visibleCount, setVisibleCount] = useState(20);
  const resultTier = (result: MatchingResult): NonNullable<MatchingResult['matchTier']> => (
    result.matchTier || (result.score >= 80 ? 'direct' : result.score >= 60 ? 'review' : 'reject')
  );
  const tierCounts = results.reduce((counts, result) => {
    if (result.assessmentStatus !== 'failed') counts[resultTier(result)] += 1;
    return counts;
  }, { direct: 0, review: 0, reject: 0 });
  const visibleResults = results
    .filter((result) => result.assessmentStatus === 'failed'
      ? tierFilter === 'failed'
      : tierFilter === 'all'
        ? true
        : tierFilter === 'actionable'
          ? resultTier(result) !== 'reject'
          : resultTier(result) === tierFilter)
    .sort((a, b) => {
      const aPriority = a.score >= 70 && Boolean(groupPriorityLabel(a.jd));
      const bPriority = b.score >= 70 && Boolean(groupPriorityLabel(b.jd));
      const priorityDifference = Number(bPriority) - Number(aPriority);
      const tierDifference = Number(resultTier(b) === 'direct') - Number(resultTier(a) === 'direct');
      return tierDifference || (sortMode === 'priority' ? priorityDifference : 0) || b.score - a.score || a.jdId.localeCompare(b.jdId);
    });

  const recommendationButton = (
    <button
      type="button"
      onClick={onGenerateRecommendationCopy}
      disabled={recommendationSelectionCount === 0 || isGeneratingCopy}
      className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
    >
      {isGeneratingCopy
        ? <Loader2 className="h-4 w-4 animate-spin" />
        : <FileText className="h-4 w-4" />}
      生成推荐文案{recommendationSelectionCount > 0 ? `（${recommendationSelectionCount}）` : ''}
    </button>
  );

  const tierNavigation = (
    <div className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 p-2 text-xs">
      {([
        ['all', '全部岗位', tierCounts.direct + tierCounts.review + tierCounts.reject],
        ['actionable', '推荐清单', tierCounts.direct + tierCounts.review],
        ['direct', '优先推荐', tierCounts.direct],
        ['review', '相近可尝试', tierCounts.review],
        ['reject', '暂不推荐', tierCounts.reject],
        ['failed', '分析失败', results.filter((result) => result.assessmentStatus === 'failed').length],
      ] as const).map(([value, label, count]) => (
        <button
          key={value}
          type="button"
          onClick={() => { setTierFilter(value); setVisibleCount(20); }}
          className={`rounded-lg px-3 py-1.5 font-medium transition-colors ${tierFilter === value
            ? 'bg-white text-indigo-600 shadow-sm ring-1 ring-slate-200'
            : 'text-slate-500 hover:text-slate-700'}`}
        >
          {label} {count}
        </button>
      ))}
      <span className="ml-auto hidden text-slate-400 lg:inline">默认展示所选类别全部已评分岗位，任意档位均可勾选</span>
    </div>
  );

  if (isMatching) {
    return (
      <div className="flex flex-col items-center justify-center py-16 space-y-4">
        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
        <div className="text-center"><p className="text-sm text-gray-600">{refinementProgress?.total ? `正在比较完整 JD（${refinementProgress.completed}/${refinementProgress.total}）` : '正在理解人选经历与岗位方向…'}</p><p className="text-xs text-gray-400 mt-1">完成后统一展示稳定排序，每轮最多比较 16 个相近岗位</p></div>
      </div>
    );
  }
  if (results.length === 0) {
    return (
      <div>
        {recommendationSelectionCount > 0 && <div className="mb-4 flex justify-end">{recommendationButton}</div>}
        <div className="flex flex-col items-center justify-center py-16 text-gray-400">
          <BarChart3 className="w-10 h-10 mb-3" />
          <p className="text-sm">{recommendationSelectionCount > 0 ? '已指定岗位，可直接生成推荐文案' : '点击「开始匹配」查看结果'}</p>
        </div>
      </div>
    );
  }
  if (visibleResults.length === 0) {
    return (
      <div className="space-y-3">
        {tierNavigation}
        <div className="flex flex-col items-center justify-center py-16 text-gray-400"><BarChart3 className="w-10 h-10 mb-3" /><p className="text-sm">当前分层暂无岗位，可切换上方分类查看其他结果</p></div>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {tierNavigation}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-medium text-gray-700 flex items-center gap-2">
          匹配结果 <span className="text-gray-400">({visibleResults.length} 个岗位)</span>
          {isMatching && <Loader2 className="w-3.5 h-3.5 text-indigo-500 animate-spin" />}
          {refinementProgress && (
            <span className="rounded-md bg-indigo-50 px-2 py-1 text-xs font-normal text-indigo-600">
              岗位分析 {refinementProgress.completed}/{refinementProgress.total}
            </span>
          )}
        </p>
        <div className="flex flex-wrap items-center justify-end gap-3 text-xs text-gray-400">
          <select aria-label="匹配结果排序" value={sortMode} onChange={(event) => setSortMode(event.target.value as 'score' | 'priority')} className="rounded border border-slate-200 p-1 text-slate-600">
            <option value="score">匹配度排序</option><option value="priority">集团优先排序</option>
          </select>
          <span className="hidden items-center gap-1 xl:flex"><span className="h-2 w-2 rounded-full bg-green-500" />优先推荐</span>
          <span className="hidden items-center gap-1 xl:flex"><span className="h-2 w-2 rounded-full bg-amber-500" />相近可尝试</span>
          {recommendationButton}
        </div>
      </div>
      {visibleResults.slice(0, visibleCount).map((result, index) => result.assessmentStatus === 'failed' ? (
        <div key={result.id} className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm">
          <p className="font-medium">{result.jd.title} · 分析未完成</p>
          <p className="mt-1 text-xs text-amber-700">{result.reasoning}。可点击“重试失败岗位”。</p>
        </div>
      ) : (
        <MatchingResultCard
          key={result.id}
          result={result}
          rank={index + 1}
          selected={selectedResultIds.has(result.id)}
          hasRecommendationCopy={generatedJdIds.has(result.jdId)}
          onToggleSelected={() => onToggleSelected(result.id)}
          onOpenRecommendationCopy={() => onOpenRecommendationCopy(result.jdId)}
        />
      ))}
      {visibleCount < visibleResults.length && <button type="button" onClick={() => setVisibleCount((count) => count + 10)} className="w-full py-3 text-sm text-indigo-600">显示更多（{visibleCount}/{visibleResults.length}）</button>}
    </div>
  );
}
