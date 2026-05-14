'use client';
import { MatchingResultCard } from './MatchingResultCard';
import { Loader2, BarChart3 } from 'lucide-react';
import type { MatchingResult } from '@/types/matching';

interface MatchingResultsListProps { results: MatchingResult[]; isMatching: boolean; }

export function MatchingResultsList({ results, isMatching }: MatchingResultsListProps) {
  if (isMatching) {
    return (
      <div className="flex flex-col items-center justify-center py-16 space-y-4">
        <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
        <div className="text-center"><p className="text-sm text-gray-600">AI 匹配分析中...</p><p className="text-xs text-gray-400 mt-1">正在调用 DeepSeek API 分析简历与岗位匹配度</p></div>
      </div>
    );
  }
  if (results.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-gray-400"><BarChart3 className="w-10 h-10 mb-3" /><p className="text-sm">点击「开始匹配」查看结果</p></div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm font-medium text-gray-700">匹配结果 <span className="text-gray-400">({results.length} 个岗位)</span></p>
        <div className="flex items-center gap-3 text-xs text-gray-400">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500" />高匹配 (≥80)</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" />中匹配 (≥60)</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" />低匹配</span>
        </div>
      </div>
      {results.map((r, i) => <MatchingResultCard key={r.id} result={r} rank={i + 1} />)}
    </div>
  );
}
