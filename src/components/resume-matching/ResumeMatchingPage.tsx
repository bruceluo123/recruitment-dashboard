'use client';
import { useEffect, useState } from 'react';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { EmptyState } from '@/components/ui/EmptyState';
import { ResumeUploader } from './ResumeUploader';
import { MatchingResultsList } from './MatchingResultsList';
import { useResumeStore } from '@/store/resume-store';
import { JD_CATEGORY_LABELS, JD_CATEGORY_COLORS, type JDCategory } from '@/types/jd';
import { FileSearch, Zap, FileText, AlertCircle, X, Filter } from 'lucide-react';
import { cn } from '@/lib/utils';

export function ResumeMatchingPage() {
  const [mounted, setMounted] = useState(false);
  const [matchCategory, setMatchCategory] = useState<JDCategory | 'all'>('all');
  const resumes = useResumeStore((s) => s.resumes);
  const activeResumeId = useResumeStore((s) => s.activeResumeId);
  const matchingResults = useResumeStore((s) => s.matchingResults);
  const isUploading = useResumeStore((s) => s.isUploading);
  const isMatching = useResumeStore((s) => s.isMatching);
  const matchError = useResumeStore((s) => s.matchError);
  const uploadResume = useResumeStore((s) => s.uploadResume);
  const setActiveResume = useResumeStore((s) => s.setActiveResume);
  const matchWithJDs = useResumeStore((s) => s.matchWithJDs);
  const cancelMatching = useResumeStore((s) => s.cancelMatching);
  const clearMatches = useResumeStore((s) => s.clearMatches);

  useEffect(() => setMounted(true), []);
  const activeResume = resumes.find((r) => r.id === activeResumeId);

  const handleMatch = () => {
    if (!activeResumeId || activeResume?.parsingStatus !== 'completed') return;
    matchWithJDs(activeResumeId, matchCategory).catch(() => {});
  };

  if (!mounted) return null;

  const allCats: (JDCategory | 'all')[] = ['all', 'frontend', 'backend', 'testing', 'product', 'design', 'devops', 'ai', 'algorithm', 'data', 'hardware', 'operations', 'advertising', 'gaming', 'finance', 'hr', 'bd', 'customer-service', 'project', 'seo', 'administration', 'director'];

  return (
    <div className="animate-fade-in space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">简历匹配</h2>
          <p className="text-sm text-gray-500 mt-1">上传简历，AI 智能匹配最适合的岗位</p>
        </div>
      </div>

      {/* Category selector bar */}
      <GlassPanel padding="md">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-sm text-gray-500 shrink-0">
            <Filter className="w-4 h-4" />
            匹配范围：
          </div>
          {allCats.map((cat) => (
            <button
              key={cat}
              onClick={() => setMatchCategory(cat)}
              disabled={isMatching}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-medium transition-all border',
                matchCategory === cat
                  ? cat === 'all'
                    ? 'bg-indigo-500 text-white border-indigo-500'
                    : `${JD_CATEGORY_COLORS[cat as JDCategory]} border-current`
                  : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300',
                isMatching && 'opacity-50',
              )}
            >
              {cat === 'all' ? '全部' : JD_CATEGORY_LABELS[cat as JDCategory]}
            </button>
          ))}
        </div>
      </GlassPanel>

      <div className="flex items-center gap-3">
        {isMatching ? (
          <button onClick={cancelMatching} className="h-10 px-5 rounded-xl bg-red-50 text-red-600 border border-red-200 text-sm font-medium hover:bg-red-100 transition-all flex items-center gap-2">
            <X className="w-4 h-4" />取消匹配
          </button>
        ) : (
          activeResume && activeResume.parsingStatus === 'completed' && (
            <button onClick={handleMatch} disabled={isMatching} className="h-10 px-5 rounded-xl bg-indigo-500 text-white text-sm font-medium hover:bg-indigo-600 transition-all flex items-center gap-2 disabled:opacity-50">
              <Zap className="w-4 h-4" />
              {matchCategory === 'all' ? '开始匹配（全部）' : `开始匹配（${JD_CATEGORY_LABELS[matchCategory as JDCategory]}）`}
            </button>
          )
        )}
      </div>

      {matchError && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-red-50 border border-red-200">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
          <p className="text-sm text-red-700 flex-1">{matchError}</p>
          <button onClick={clearMatches} className="text-red-400 hover:text-red-600"><X className="w-4 h-4" /></button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6">
        <div className="space-y-4">
          <GlassPanel>
            <h3 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2"><FileSearch className="w-4 h-4 text-indigo-500" />上传简历</h3>
            <ResumeUploader onFileSelected={(f) => uploadResume(f)} isUploading={isUploading} resumes={resumes} activeResumeId={activeResumeId} onSelectResume={setActiveResume} />
          </GlassPanel>
          {activeResume && activeResume.rawText && (
            <GlassPanel>
              <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2"><FileText className="w-4 h-4 text-indigo-500" />简历预览</h3>
              <p className="text-xs text-gray-500 leading-relaxed max-h-48 overflow-y-auto whitespace-pre-line">{activeResume.rawText.slice(0, 1000)}{activeResume.rawText.length > 1000 && '...'}</p>
            </GlassPanel>
          )}
        </div>
        <GlassPanel>
          <MatchingResultsList results={matchingResults} isMatching={isMatching} />
          {!activeResume && matchingResults.length === 0 && !isMatching && <EmptyState icon={FileSearch} title="上传简历开始匹配" description="支持 PDF 和 DOCX 格式，选择匹配范围后点击开始匹配" />}
        </GlassPanel>
      </div>
    </div>
  );
}
