'use client';
import { useEffect, useState } from 'react';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { EmptyState } from '@/components/ui/EmptyState';
import { ResumeUploader } from './ResumeUploader';
import { MatchingResultsList } from './MatchingResultsList';
import { useResumeStore } from '@/store/resume-store';
import { FileSearch, Zap, FileText, AlertCircle, X } from 'lucide-react';

export function ResumeMatchingPage() {
  const [mounted, setMounted] = useState(false);
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
    matchWithJDs(activeResumeId).catch(() => {});
  };

  if (!mounted) return null;

  return (
    <div className="animate-fade-in space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">简历匹配</h2>
          <p className="text-sm text-gray-500 mt-1">上传简历，AI 智能匹配最适合的岗位</p>
        </div>
        <div className="flex items-center gap-3">
          {isMatching ? (
            <button onClick={cancelMatching} className="h-10 px-5 rounded-xl bg-red-50 text-red-600 border border-red-200 text-sm font-medium hover:bg-red-100 transition-all flex items-center gap-2">
              <X className="w-4 h-4" />取消匹配
            </button>
          ) : (
            activeResume && activeResume.parsingStatus === 'completed' && (
              <button onClick={handleMatch} disabled={isMatching} className="h-10 px-5 rounded-xl bg-indigo-500 text-white text-sm font-medium hover:bg-indigo-600 transition-all flex items-center gap-2 disabled:opacity-50">
                <Zap className="w-4 h-4" />开始匹配
              </button>
            )
          )}
        </div>
      </div>

      {/* Error banner */}
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
          {!activeResume && matchingResults.length === 0 && !isMatching && <EmptyState icon={FileSearch} title="上传简历开始匹配" description="支持 PDF 和 DOCX 格式，解析后系统将自动匹配岗位库中的所有活跃 JD" />}
        </GlassPanel>
      </div>
    </div>
  );
}
