'use client';
import { useEffect, useState } from 'react';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { EmptyState } from '@/components/ui/EmptyState';
import { ResumeUploader } from './ResumeUploader';
import { MatchingResultsList } from './MatchingResultsList';
import { RecommendationCandidateDialog } from './RecommendationCandidateDialog';
import { RecommendationCopyDialog, type RecommendationCopyItem } from './RecommendationCopyDialog';
import { useResumeStore, MATCH_TTL_MS } from '@/store/resume-store';
import { useRepushStore, type RepushColumnId } from '@/store/repush-store';
import { usePrefStore } from '@/store/pref-store';
import { JD_CATEGORY_LABELS, JD_CATEGORY_COLORS, ALL_CATEGORIES, type JDCategory } from '@/types/jd';
import type { JD } from '@/types/jd';
import type { Resume } from '@/types/resume';
import { FileSearch, Zap, FileText, AlertCircle, X, Filter, Trash2, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { extractRecommendationInfo, type ExtractedRecommendation } from '@/lib/recommendation';

const OWNER_CONFIG: Record<RepushColumnId, { name: string; codePrefix: string; storageKey: string; recommender: string }> = {
  a: {
    name: '麦满分',
    codePrefix: 'XYMMF00',
    storageKey: 'recruit:next-mmf-candidate-code',
    recommender: '麦满分 @bruceluo123',
  },
  b: {
    name: '啵啵',
    codePrefix: 'XYBB00',
    storageKey: 'recruit:next-bb-candidate-code',
    recommender: 'BOBO @bobomiepucha',
  },
};

function nextCandidateCodeSuffix(owner: RepushColumnId): string {
  const config = OWNER_CONFIG[owner];
  const codePattern = new RegExp(`^${config.codePrefix}(\\d{3})$`);
  const existingMax = useRepushStore.getState().items.reduce((max, item) => {
    const match = item.candidateCode?.trim().toUpperCase().match(codePattern);
    return match ? Math.max(max, Number.parseInt(match[1], 10)) : max;
  }, 0);
  const stored = typeof window === 'undefined'
    ? 0
    : Number.parseInt(window.localStorage.getItem(config.storageKey) || '', 10) || 0;
  return String(Math.min(Math.max(existingMax + 1, stored, 1), 999)).padStart(3, '0');
}

function reserveNextCandidateCode(owner: RepushColumnId, currentSuffix: string): void {
  if (typeof window === 'undefined') return;
  const current = Number.parseInt(currentSuffix, 10);
  if (!Number.isFinite(current)) return;
  window.localStorage.setItem(OWNER_CONFIG[owner].storageKey, String(Math.min(current + 1, 999)).padStart(3, '0'));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readLabeledValue(text: string, labels: string[]): string {
  for (const label of labels) {
    const match = text.match(new RegExp(`${escapeRegExp(label)}[^\\n:：]*[:：][ \\t\\u3000]*([^\\n]*)`, 'i'));
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return '';
}

function readCandidateValue(candidateText: string, resumeText: string, labels: string[]): string {
  return readLabeledValue(candidateText, labels) || readLabeledValue(resumeText, labels);
}

function buildCandidateCode(owner: RepushColumnId, codeSuffix: string, extractedCode: string): string {
  const prefix = OWNER_CONFIG[owner].codePrefix;
  const digits = codeSuffix.replace(/\D/g, '').slice(0, 3);
  return digits ? `${prefix}${digits.padStart(3, '0')}` : extractedCode || prefix;
}

function safeFilePart(value: string): string {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim();
}

function buildRecommendationCopy(
  resume: Resume,
  info: ExtractedRecommendation,
  jd: JD,
  candidateText: string,
  codeSuffix: string,
  resumeSource: string,
  resumeFileName: string,
  owner: RepushColumnId,
): RecommendationCopyItem {
  const resumeText = resume.rawText.slice(0, 6000);
  const workYears = readCandidateValue(candidateText, resumeText, ['工作年限', '工作经验年限', '工作经验'])
    || `${candidateText}\n${resumeText}`.match(/\d+(?:\.\d+)?\s*年(?:以上)?(?:相关)?(?:工作)?经验/)?.[0]
    || '';
  const currentSalary = readCandidateValue(candidateText, resumeText, ['当前薪资', '目前薪资', '现薪资', '现薪']);
  const expectedSalary = readCandidateValue(candidateText, resumeText, ['期望薪资', '薪资期望', '期望月薪']);
  const location = readCandidateValue(candidateText, resumeText, ['目前所在地', '当前所在地', '现居地', '所在地', '现居']);
  const arrivalTime = readCandidateValue(candidateText, resumeText, ['预计可到岗时间', '可到岗时间', '到岗时间', '最快到岗时间']);
  const organizationParts = [jd.organization, jd.department, jd.serviceUnit]
    .map((value) => value?.trim())
    .filter((value): value is string => !!value);
  const organization = Array.from(new Set(organizationParts)).join('/');
  const candidateName = info.name || resume.parsedData.name || resume.fileName.replace(/\.(pdf|docx)$/i, '');
  const candidateCode = buildCandidateCode(owner, codeSuffix, info.candidateCode);
  const extension = resumeFileName.match(/\.(pdf|docx?)$/i)?.[0].toLowerCase() || '.pdf';
  const renamedResume = `${[candidateName, jd.title].map(safeFilePart).filter(Boolean).join('-')}${extension}`;

  const recommendationText = [
    `候选人编码：${candidateCode}`,
    `${owner === 'b' ? '候选人姓名' : '候选人姓名（英文名）'}：${candidateName}`,
    `应聘岗位：${jd.title}`,
    `工作年限：${workYears}`,
    `当前薪资：${currentSalary}`,
    `期望薪资：${expectedSalary}`,
    `目前所在地：${location}`,
    `预计可到岗时间：${arrivalTime}`,
    '是否已沟通工作地点：是',
    '是否已沟通行业背景要求：是',
    `推荐编制组织/序列/服务单位：${organization}`,
    '招聘渠道：寻英',
    `简历推荐人：${OWNER_CONFIG[owner].recommender}`,
    `简历来源：${resumeSource || 'boss'}`,
    `候选人联系方式：${info.contact || '/'}`,
    `简历对接BP：${jd.odc?.trim() || ''}`,
  ].join('\n');

  return {
    jdId: jd.id,
    title: jd.title,
    organization,
    contactPerson: jd.odc?.trim() || '',
    fileName: renamedResume,
    text: recommendationText,
  };
}

export function ResumeMatchingPage() {
  const [mounted, setMounted] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [matchCategory, setMatchCategory] = useState<JDCategory | 'all'>('all');
  const [selectedResultIds, setSelectedResultIds] = useState<Set<string>>(() => new Set());
  const [recommendationCopies, setRecommendationCopies] = useState<RecommendationCopyItem[]>([]);
  const [candidateDialogOpen, setCandidateDialogOpen] = useState(false);
  const [candidateInfoText, setCandidateInfoText] = useState('');
  const [candidateCodeSuffix, setCandidateCodeSuffix] = useState('');
  const [recommendationResumeSource, setRecommendationResumeSource] = useState('boss');
  const [recommendationResumeFile, setRecommendationResumeFile] = useState<File | null>(null);
  const [recommendationResumeBlobUrl, setRecommendationResumeBlobUrl] = useState('');
  const [copyDialogOpen, setCopyDialogOpen] = useState(false);
  const [copyDialogInitialJdId, setCopyDialogInitialJdId] = useState('');
  const [isGeneratingCopy, setIsGeneratingCopy] = useState(false);
  const activeOwner = usePrefStore((s) => s.activeOwner);
  const setActiveOwner = usePrefStore((s) => s.setActiveOwner);
  const resumes = useResumeStore((s) => s.resumes);
  const activeResumeId = useResumeStore((s) => s.activeResumeId);
  const resultsByResume = useResumeStore((s) => s.resultsByResume);
  const isUploading = useResumeStore((s) => s.isUploading);
  const isMatching = useResumeStore((s) => s.isMatching);
  const matchingResumeId = useResumeStore((s) => s.matchingResumeId);
  const matchError = useResumeStore((s) => s.matchError);
  const uploadError = useResumeStore((s) => s.uploadError);
  const uploadResume = useResumeStore((s) => s.uploadResume);
  const setActiveResume = useResumeStore((s) => s.setActiveResume);
  const matchWithJDs = useResumeStore((s) => s.matchWithJDs);
  const cancelMatching = useResumeStore((s) => s.cancelMatching);
  const clearMatchesFor = useResumeStore((s) => s.clearMatchesFor);
  const pruneExpired = useResumeStore((s) => s.pruneExpired);
  const removeResume = useResumeStore((s) => s.removeResume);

  const handleRemoveResume = (id: string) => {
    removeResume(id);
  };

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    setSelectedResultIds(new Set());
    setRecommendationCopies([]);
    setCandidateDialogOpen(false);
    setCandidateInfoText('');
    setCandidateCodeSuffix(nextCandidateCodeSuffix(activeOwner));
    setRecommendationResumeSource('boss');
    setRecommendationResumeFile(null);
    setRecommendationResumeBlobUrl('');
    setCopyDialogOpen(false);
    setCopyDialogInitialJdId('');
    setIsGeneratingCopy(false);
  }, [activeOwner, activeResumeId]);

  // 每 10 秒刷新一次时间并清理过期结果，驱动倒计时显示
  useEffect(() => {
    const t = setInterval(() => {
      setNow(Date.now());
      pruneExpired();
    }, 10 * 1000);
    return () => clearInterval(t);
  }, [pruneExpired]);

  const activeResume = resumes.find((r) => r.id === activeResumeId);
  const activeBatch = activeResumeId ? resultsByResume[activeResumeId] : undefined;
  const activeResults = activeBatch?.results || [];
  const activeIsMatching = isMatching && matchingResumeId === activeResumeId;
  // 当前简历结果剩余存活时间（正在匹配的简历不倒计时）
  const remainMs = activeBatch && !activeIsMatching ? MATCH_TTL_MS - (now - activeBatch.matchedAt) : 0;
  const remainMin = Math.max(0, Math.ceil(remainMs / 60000));

  const handleMatch = () => {
    if (!activeResumeId || activeResume?.parsingStatus !== 'completed') return;
    setSelectedResultIds(new Set());
    setRecommendationCopies([]);
    setCandidateDialogOpen(false);
    setCopyDialogOpen(false);
    matchWithJDs(activeResumeId, matchCategory).catch(() => {});
  };

  const handleToggleSelected = (resultId: string) => {
    setSelectedResultIds((previous) => {
      const next = new Set(previous);
      if (next.has(resultId)) next.delete(resultId);
      else next.add(resultId);
      return next;
    });
    setRecommendationCopies([]);
    setCandidateDialogOpen(false);
    setCopyDialogOpen(false);
  };

  const handleRequestRecommendationCopy = () => {
    if (!activeResume || selectedResultIds.size === 0 || isGeneratingCopy) return;
    setCandidateCodeSuffix(nextCandidateCodeSuffix(activeOwner));
    if (!recommendationResumeFile && activeResume.file) {
      setRecommendationResumeFile(activeResume.file);
      setRecommendationResumeBlobUrl(activeResume.blobUrl || '');
    }
    setCopyDialogOpen(false);
    setCandidateDialogOpen(true);
  };

  const handleGenerateRecommendationCopy = async (candidateText: string, codeSuffix: string, resumeFile: File | null, resumeSource: string) => {
    if (!activeResume || selectedResultIds.size === 0 || isGeneratingCopy) return;
    const resumeId = activeResume.id;
    const selectedResults = activeResults.filter((result) => selectedResultIds.has(result.id));
    if (selectedResults.length === 0) return;

    setCandidateInfoText(candidateText);
    setCandidateCodeSuffix(codeSuffix);
    setRecommendationResumeSource(resumeSource);
    setRecommendationResumeFile(resumeFile);
    setRecommendationResumeBlobUrl(resumeFile && resumeFile === activeResume.file ? activeResume.blobUrl || '' : '');
    setCandidateDialogOpen(false);
    setIsGeneratingCopy(true);
    try {
      const info = await extractRecommendationInfo(candidateText || activeResume.rawText);
      if (useResumeStore.getState().activeResumeId !== resumeId) return;
      const copies = selectedResults.map((result) => (
        buildRecommendationCopy(
          activeResume,
          info,
          result.jd,
          candidateText,
          codeSuffix,
          resumeSource,
          resumeFile?.name || activeResume.fileName,
          activeOwner,
        )
      ));
      setRecommendationCopies(copies);
      if (copies.length > 0) reserveNextCandidateCode(activeOwner, codeSuffix);
      setCopyDialogInitialJdId(copies[0]?.jdId || '');
      setCopyDialogOpen(copies.length > 0);
    } finally {
      setIsGeneratingCopy(false);
    }
  };

  const handleOpenRecommendationCopy = (jdId: string) => {
    if (!recommendationCopies.some((item) => item.jdId === jdId)) return;
    setCopyDialogInitialJdId(jdId);
    setCopyDialogOpen(true);
  };

  if (!mounted) return null;

  // 用权威的 ALL_CATEGORIES，确保新增分类（市场/美术/视频/直播/法务/培训/内容）也出现在匹配范围
  const allCats: (JDCategory | 'all')[] = ['all', ...ALL_CATEGORIES];

  return (
    <div className="workspace-page max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="page-title">简历匹配</h2>
          <p className="page-subtitle">上传简历，AI 智能匹配最适合的岗位</p>
        </div>
        <div className="flex overflow-hidden rounded-xl border border-gray-200 bg-white text-sm shadow-sm" aria-label="当前推荐人">
          {(['a', 'b'] as RepushColumnId[]).map((owner) => (
            <button
              type="button"
              key={owner}
              onClick={() => setActiveOwner(owner)}
              className={cn(
                'h-10 px-4 font-medium transition-colors',
                activeOwner === owner ? 'bg-indigo-500 text-white' : 'text-gray-500 hover:bg-indigo-50',
              )}
            >
              {OWNER_CONFIG[owner].name}
            </button>
          ))}
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

      <div className="flex items-center gap-3 flex-wrap">
        {activeIsMatching ? (
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
        {activeResults.length > 0 && !activeIsMatching && (
          <>
            <button onClick={() => {
              if (!activeResumeId) return;
              setSelectedResultIds(new Set());
              setRecommendationCopies([]);
              setCopyDialogOpen(false);
              clearMatchesFor(activeResumeId);
            }} className="h-10 px-4 rounded-xl bg-white text-gray-600 border border-gray-200 text-sm font-medium hover:bg-gray-50 transition-all flex items-center gap-2">
              <Trash2 className="w-4 h-4" />清除结果
            </button>
            {remainMin > 0 && (
              <span className="flex items-center gap-1.5 text-xs text-gray-400">
                <Clock className="w-3.5 h-3.5" />{remainMin} 分钟后自动清除
              </span>
            )}
          </>
        )}
      </div>

      {uploadError && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200">
          <AlertCircle className="w-5 h-5 text-amber-500 shrink-0" />
          <p className="text-sm text-amber-700 flex-1">{uploadError}</p>
        </div>
      )}

      {matchError && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-red-50 border border-red-200">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
          <p className="text-sm text-red-700 flex-1">{matchError}</p>
          <button onClick={() => activeResumeId && clearMatchesFor(activeResumeId)} className="text-red-400 hover:text-red-600"><X className="w-4 h-4" /></button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6">
        <div className="space-y-4">
          <GlassPanel>
            <h3 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2"><FileSearch className="w-4 h-4 text-indigo-500" />上传简历</h3>
            <ResumeUploader onFileSelected={(f) => uploadResume(f)} isUploading={isUploading} resumes={resumes} activeResumeId={activeResumeId} onSelectResume={setActiveResume} onRemoveResume={handleRemoveResume} resultCounts={Object.fromEntries(Object.entries(resultsByResume).map(([id, b]) => [id, b.results.length]))} />
          </GlassPanel>
          {activeResume && activeResume.rawText && (
            <GlassPanel>
              <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2"><FileText className="w-4 h-4 text-indigo-500" />简历预览</h3>
              <p className="text-xs text-gray-500 leading-relaxed max-h-48 overflow-y-auto whitespace-pre-line">{activeResume.rawText.slice(0, 1000)}{activeResume.rawText.length > 1000 && '...'}</p>
            </GlassPanel>
          )}
        </div>
        <GlassPanel>
          <MatchingResultsList
            results={activeResults}
            isMatching={activeIsMatching}
            selectedResultIds={selectedResultIds}
            generatedJdIds={new Set(recommendationCopies.map((item) => item.jdId))}
            isGeneratingCopy={isGeneratingCopy}
            onToggleSelected={handleToggleSelected}
            onGenerateRecommendationCopy={handleRequestRecommendationCopy}
            onOpenRecommendationCopy={handleOpenRecommendationCopy}
          />
          {!activeResume && activeResults.length === 0 && !activeIsMatching && <EmptyState icon={FileSearch} title="上传简历开始匹配" description="支持 PDF 和 DOCX 格式，选择匹配范围后点击开始匹配" />}
        </GlassPanel>
      </div>
      {candidateDialogOpen && (
        <RecommendationCandidateDialog
          jobCount={selectedResultIds.size}
          codePrefix={OWNER_CONFIG[activeOwner].codePrefix}
          initialCandidateText={candidateInfoText}
          initialCodeSuffix={candidateCodeSuffix}
          initialResumeFile={recommendationResumeFile || activeResume?.file || null}
          initialResumeSource={recommendationResumeSource}
          onClose={() => setCandidateDialogOpen(false)}
          onGenerate={handleGenerateRecommendationCopy}
        />
      )}
      {copyDialogOpen && recommendationCopies.length > 0 && (
        <RecommendationCopyDialog
          owner={activeOwner}
          items={recommendationCopies}
          initialJdId={copyDialogInitialJdId}
          resumeFile={recommendationResumeFile}
          resumeBlobUrl={recommendationResumeBlobUrl}
          onEditCandidateInfo={() => {
            setCopyDialogOpen(false);
            setCandidateDialogOpen(true);
          }}
          onClose={() => setCopyDialogOpen(false)}
        />
      )}
    </div>
  );
}
