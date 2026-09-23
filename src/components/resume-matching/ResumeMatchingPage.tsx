'use client';
import { useEffect, useRef, useState } from 'react';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { EmptyState } from '@/components/ui/EmptyState';
import { ResumeUploader } from './ResumeUploader';
import { MatchingResultsList } from './MatchingResultsList';
import { RecommendationCandidateDialog } from './RecommendationCandidateDialog';
import {
  RecommendationCopyDialog,
  type RecommendationCopyItem,
  type RecommendationDeliverySnapshot,
} from './RecommendationCopyDialog';
import { TargetJDPickerDialog } from './TargetJDPickerDialog';
import { useResumeStore } from '@/store/resume-store';
import { useJDStore } from '@/store/jd-store';
import { useRepushStore, type RecommendationDeliveryStatus, type RepushColumnId } from '@/store/repush-store';
import { usePrefStore } from '@/store/pref-store';
import { JD_CATEGORY_LABELS, JD_CATEGORY_COLORS, ALL_CATEGORIES, type JDCategory } from '@/types/jd';
import type { JD } from '@/types/jd';
import type { Resume } from '@/types/resume';
import { FileSearch, Zap, FileText, AlertCircle, X, Filter, Trash2, Clock, ListChecks, Loader2, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { extractRecommendationInfo, type ExtractedRecommendation } from '@/lib/recommendation';
import { buildRecommendationText, recommendationOrganization } from '@/lib/recommendation-copy';
import { applyRemoteStoreUpdate } from '@/lib/sync';

const OWNER_CONFIG: Record<RepushColumnId, { name: string; codePrefix: string }> = {
  a: {
    name: '麦满分',
    codePrefix: 'XYMMF00',
  },
  b: {
    name: '啵啵',
    codePrefix: 'XYBB00',
  },
};

interface CandidateCodeAllocation {
  code: string;
  candidateIdentityId: string;
}

async function allocateCandidateCode(
  owner: RepushColumnId,
  preferredCode: string | undefined,
  candidateName: string,
  candidateIdentityId?: string,
): Promise<CandidateCodeAllocation> {
  let lastError = '候选人编号分配失败，请重试';
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch('/api/candidate-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner, preferredCode, candidateName, candidateIdentityId }),
        signal: AbortSignal.timeout(20_000),
      });
      const result = await response.json().catch(() => ({})) as Partial<CandidateCodeAllocation> & { error?: string };
      if (response.ok && result.code && result.candidateIdentityId) {
        return { code: result.code, candidateIdentityId: result.candidateIdentityId };
      }
      lastError = result.error || lastError;
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500
        || (response.status === 409 && lastError.includes('并发'));
      if (!retryable) throw new Error(lastError);
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
      if (error instanceof Error && !['AbortError', 'TimeoutError'].includes(error.name)
        && !lastError.includes('fetch') && !lastError.includes('并发') && !lastError.includes('频繁')
        && !lastError.includes('分配失败')) throw error;
    }
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
  }
  throw new Error(lastError);
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

function safeFilePart(value: string): string {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim();
}

function candidateNameForResume(resume: Resume, info: ExtractedRecommendation, useOriginalResume: boolean): string {
  return (info.name
    || (useOriginalResume ? resume.parsedData.name : '')
    || '').trim();
}

function buildRecommendationCopy(
  resume: Resume,
  info: ExtractedRecommendation,
  jd: JD,
  candidateText: string,
  candidateCode: string,
  candidateIdentityId: string,
  candidateName: string,
  resumeSource: string,
  resumeFileName: string,
  owner: RepushColumnId,
  useOriginalResume = true,
): RecommendationCopyItem {
  const resumeText = useOriginalResume ? resume.rawText.slice(0, 6000) : '';
  const workYears = readCandidateValue(candidateText, resumeText, ['工作年限', '工作经验年限', '工作经验'])
    || `${candidateText}\n${resumeText}`.match(/\d+(?:\.\d+)?\s*年(?:以上)?(?:相关)?(?:工作)?经验/)?.[0]
    || '';
  const currentSalary = readCandidateValue(candidateText, resumeText, ['当前薪资', '目前薪资', '现薪资', '现薪']);
  const expectedSalary = readCandidateValue(candidateText, resumeText, ['期望薪资', '薪资期望', '期望月薪']);
  const location = readCandidateValue(candidateText, resumeText, ['目前所在地', '当前所在地', '现居地', '所在地', '现居']);
  const arrivalTime = readCandidateValue(candidateText, resumeText, ['预计可到岗时间', '可到岗时间', '到岗时间', '最快到岗时间']);
  const organization = recommendationOrganization(jd);
  const extension = resumeFileName.match(/\.(pdf|docx?|jpe?g|png|webp|gif)$/i)?.[0].toLowerCase() || '.pdf';
  const renamedResume = `${[candidateName, jd.title].map(safeFilePart).filter(Boolean).join('-')}${extension}`;

  const recommendationText = buildRecommendationText(owner, jd, {
    candidateCode,
    candidateName,
    workYears,
    currentSalary,
    expectedSalary,
    location,
    arrivalTime,
    contact: info.contact,
    resumeSource,
  });

  return {
    jdId: jd.id,
    title: jd.title,
    organization,
    department: jd.department?.trim() || '',
    contactPerson: jd.odc?.trim() || '',
    candidateCode,
    candidateIdentityId,
    candidateName,
    contact: info.contact || '',
    fileName: renamedResume,
    text: recommendationText,
  };
}

export function ResumeMatchingPage() {
  const [mounted, setMounted] = useState(false);
  const [matchCategory, setMatchCategory] = useState<JDCategory | 'all'>('all');
  const [targetJDIds, setTargetJDIds] = useState<Set<string>>(() => new Set());
  const [targetJDPickerOpen, setTargetJDPickerOpen] = useState(false);
  const [selectedResultIds, setSelectedResultIds] = useState<Set<string>>(() => new Set());
  const [recommendationCopies, setRecommendationCopies] = useState<RecommendationCopyItem[]>([]);
  const [candidateDialogOpen, setCandidateDialogOpen] = useState(false);
  const [candidateInfoText, setCandidateInfoText] = useState('');
  const [reservedCandidateCode, setReservedCandidateCode] = useState('');
  const [reservedCandidateIdentityId, setReservedCandidateIdentityId] = useState('');
  const [recommendationOwner, setRecommendationOwner] = useState<RepushColumnId | null>(null);
  const [candidateCodeError, setCandidateCodeError] = useState('');
  const [recommendationResumeSource, setRecommendationResumeSource] = useState('boss');
  const [recommendationResumeFile, setRecommendationResumeFile] = useState<File | null>(null);
  const [recommendationResumeBlobUrl, setRecommendationResumeBlobUrl] = useState('');
  const [copyDialogOpen, setCopyDialogOpen] = useState(false);
  const [copyDialogInitialJdId, setCopyDialogInitialJdId] = useState('');
  const [isGeneratingCopy, setIsGeneratingCopy] = useState(false);
  const [rematchNotice, setRematchNotice] = useState<{ tone: 'loading' | 'success' | 'error'; text: string } | null>(null);
  const recommendationGeneration = useRef(0);
  const rematchRequest = useRef('');
  const rematchLoadGeneration = useRef(0);
  const rematchAbortController = useRef<AbortController | null>(null);
  const rematchResumeId = useRef('');
  const pendingCandidateIdentity = useRef('');
  const ignorePastedCandidateCode = useRef(false);
  const activeOwner = usePrefStore((s) => s.activeOwner);
  const setActiveOwner = usePrefStore((s) => s.setActiveOwner);
  const jds = useJDStore((s) => s.jds);
  const addRecommendation = useRepushStore((s) => s.addRecommendation);
  const upsertDeliveryRecommendation = useRepushStore((s) => s.upsertDeliveryRecommendation);
  const recommendationItems = useRepushStore((s) => s.items);
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
  const removeResume = useResumeStore((s) => s.removeResume);

  const handleRemoveResume = (id: string) => {
    removeResume(id);
  };

  const clearRematchParam = () => {
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.delete('rematch');
    window.history.replaceState(window.history.state, '', `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
  };

  const cancelAutomaticResumeLoad = () => {
    rematchLoadGeneration.current += 1;
    rematchAbortController.current?.abort();
    rematchAbortController.current = null;
    if (rematchResumeId.current) {
      useResumeStore.getState().removeResume(rematchResumeId.current);
      rematchResumeId.current = '';
    }
    rematchRequest.current = '';
    setRematchNotice(null);
    clearRematchParam();
  };

  useEffect(() => setMounted(true), []);
  useEffect(() => () => rematchAbortController.current?.abort(), []);

  useEffect(() => {
    if (!mounted || isUploading) return;
    const recommendationId = new URLSearchParams(window.location.search).get('rematch')?.trim() || '';
    if (!recommendationId || rematchRequest.current === recommendationId) return;
    const source = recommendationItems.find((item) => item.id === recommendationId);
    if (!source) return;
    rematchRequest.current = recommendationId;
    const loadGeneration = ++rematchLoadGeneration.current;
    const controller = new AbortController();
    rematchAbortController.current?.abort();
    rematchAbortController.current = controller;
    rematchResumeId.current = '';

    if (!source.resumeUrl) {
      setRematchNotice({ tone: 'error', text: '这条推荐没有可复用的简历文件，请返回推荐中心补充简历。' });
      return;
    }

    const loadExistingResume = async () => {
      setActiveOwner(source.column);
      setRematchNotice({ tone: 'loading', text: `正在自动载入 ${source.candidateName || source.resumeFileName || '候选人'} 的原简历…` });
      try {
        const response = await fetch(source.resumeUrl!, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error(`原简历读取失败（${response.status}）`);
        const blob = await response.blob();
        if (loadGeneration !== rematchLoadGeneration.current) return;
        const fallbackName = `${source.candidateName || '候选人'}-简历.pdf`;
        const fileName = source.resumeFileName || source.fileName || fallbackName;
        const file = new File([blob], fileName, { type: blob.type || 'application/octet-stream' });
        const uploadPromise = uploadResume(file);
        rematchResumeId.current = useResumeStore.getState().resumes.find((resume) => resume.file === file)?.id || '';
        const resumeId = await uploadPromise;
        if (loadGeneration !== rematchLoadGeneration.current) {
          if (resumeId) useResumeStore.getState().removeResume(resumeId);
          return;
        }
        if (!resumeId) throw new Error('简历自动载入失败，请先删除一份已保留的简历后重试');
        const loaded = useResumeStore.getState().resumes.find((resume) => resume.id === resumeId);
        if (!loaded || loaded.parsingStatus !== 'completed') {
          throw new Error(loaded?.parseError || '简历识别失败，请在左侧点击重试');
        }
        setActiveResume(resumeId);
        setMatchCategory('all');
        setTargetJDIds(new Set());
        setRematchNotice({ tone: 'success', text: `${fileName} 已自动载入，请选择本次需要匹配的岗位。` });
        setTargetJDPickerOpen(true);
        clearRematchParam();
      } catch (error) {
        if (controller.signal.aborted || loadGeneration !== rematchLoadGeneration.current) return;
        setRematchNotice({ tone: 'error', text: error instanceof Error ? error.message : '简历自动载入失败，请重试' });
      } finally {
        if (loadGeneration === rematchLoadGeneration.current) {
          rematchAbortController.current = null;
          rematchResumeId.current = '';
        }
      }
    };

    void loadExistingResume();
  }, [isUploading, mounted, recommendationItems, setActiveOwner, setActiveResume, uploadResume]);

  useEffect(() => {
    recommendationGeneration.current += 1;
    pendingCandidateIdentity.current = '';
    ignorePastedCandidateCode.current = false;
    setSelectedResultIds(new Set());
    setRecommendationCopies([]);
    setCandidateDialogOpen(false);
    setCandidateInfoText('');
    setReservedCandidateCode('');
    setReservedCandidateIdentityId('');
    setRecommendationOwner(null);
    setCandidateCodeError('');
    setRecommendationResumeSource('boss');
    setRecommendationResumeFile(null);
    setRecommendationResumeBlobUrl('');
    setCopyDialogOpen(false);
    setCopyDialogInitialJdId('');
    setIsGeneratingCopy(false);
  }, [activeOwner, activeResumeId]);

  const activeResume = resumes.find((r) => r.id === activeResumeId);
  const activeBatch = activeResumeId ? resultsByResume[activeResumeId] : undefined;
  const activeResults = activeBatch?.results || [];
  const recommendationJDById = new Map<string, JD>();
  for (const jd of jds) {
    if (targetJDIds.has(jd.id) && jd.status !== 'paused') recommendationJDById.set(jd.id, jd);
  }
  for (const result of activeResults) {
    if (selectedResultIds.has(result.id) && !recommendationJDById.has(result.jdId)) {
      const currentJd = jds.find(jd => jd.id === result.jdId && jd.status !== 'paused');
      if (currentJd) recommendationJDById.set(result.jdId, currentJd);
    }
  }
  const recommendationJDs = Array.from(recommendationJDById.values());
  const requestedJdIds = new Set([...Array.from(targetJDIds), ...activeResults.filter(result => selectedResultIds.has(result.id)).map(result => result.jdId)]);
  const unavailableJdCount = requestedJdIds.size - recommendationJDs.length;
  const recommendationSelectionCount = recommendationJDs.length;
  const remainingJobCount = Math.max(0, (activeBatch?.scopeIds?.length || 0) - activeResults.filter((result) => activeBatch?.scopeIds?.includes(result.jdId)).length);
  const failedJobCount = activeResults.filter((result) => result.assessmentStatus === 'failed').length;
  const activeIsMatching = isMatching && matchingResumeId === activeResumeId;

  const handleMatch = () => {
    if (!activeResumeId || activeResume?.parsingStatus !== 'completed') return;
    setSelectedResultIds(new Set());
    setRecommendationCopies([]);
    setCandidateDialogOpen(false);
    setCopyDialogOpen(false);
    matchWithJDs(activeResumeId, matchCategory, targetJDIds.size > 0 ? Array.from(targetJDIds) : undefined).catch(() => {});
  };

  const handleToggleSelected = (resultId: string) => {
    setSelectedResultIds((previous) => {
      const next = new Set(previous);
      if (next.has(resultId)) next.delete(resultId);
      else {
        const result = activeResults.find((item) => item.id === resultId);
        if (result && (targetJDIds.has(result.jdId) || recommendationSelectionCount < 10)) next.add(resultId);
      }
      return next;
    });
    setRecommendationCopies([]);
    setCandidateDialogOpen(false);
    setCopyDialogOpen(false);
  };

  const handleRequestRecommendationCopy = () => {
    if (!activeResume || recommendationSelectionCount === 0 || isGeneratingCopy) return;
    if (unavailableJdCount) {
      setCandidateCodeError('部分已勾选岗位已关闭或移除，请重新选择岗位');
      return;
    }
    setCandidateCodeError('');
    if (!recommendationResumeFile) {
      setRecommendationResumeFile(activeResume.file || null);
      setRecommendationResumeBlobUrl(activeResume.blobUrl || '');
    }
    setCopyDialogOpen(false);
    setCandidateDialogOpen(true);
  };

  const handleGenerateRecommendationCopy = async (candidateText: string, resumeFile: File | null, resumeSource: string, preserveIdentity = false) => {
    if (!activeResume || recommendationSelectionCount === 0 || isGeneratingCopy) return;
    const resumeId = activeResume.id;
    const selectedJDs = recommendationJDs;
    if (selectedJDs.length === 0) return;
    const owner = activeOwner;
    const generation = ++recommendationGeneration.current;
    const isStale = () => generation !== recommendationGeneration.current
      || useResumeStore.getState().activeResumeId !== resumeId
      || usePrefStore.getState().activeOwner !== owner;

    const replacesBoundFile = resumeFile !== recommendationResumeFile
      && Boolean(reservedCandidateCode || reservedCandidateIdentityId || pendingCandidateIdentity.current);
    const resetIdentity = replacesBoundFile && !preserveIdentity;
    if (resetIdentity) {
      setReservedCandidateCode('');
      setReservedCandidateIdentityId('');
      pendingCandidateIdentity.current = '';
      ignorePastedCandidateCode.current = true;
    }

    setCandidateInfoText(candidateText);
    setRecommendationResumeSource(resumeSource);
    setRecommendationResumeFile(resumeFile);
    setRecommendationResumeBlobUrl(resumeFile === recommendationResumeFile && recommendationResumeBlobUrl
      ? recommendationResumeBlobUrl
      : !resumeFile || resumeFile === activeResume.file ? activeResume.blobUrl || '' : '');
    setIsGeneratingCopy(true);
    setCandidateCodeError('');
    try {
      const useOriginalResume = !resumeFile || resumeFile === activeResume.file;
      const info = await extractRecommendationInfo(candidateText || (useOriginalResume ? activeResume.rawText : ''));
      if (isStale()) return;
      const prefix = OWNER_CONFIG[owner].codePrefix;
      const extractedCode = info.candidateCode?.trim().toUpperCase() || '';
      const reusableCode = !ignorePastedCandidateCode.current && extractedCode.startsWith(prefix) ? extractedCode : '';
      const preferredCode = reusableCode || (!resetIdentity ? reservedCandidateCode : '') || undefined;
      const resumeFileName = resumeFile?.name || activeResume.fileName;
      const candidateName = candidateNameForResume(activeResume, info, useOriginalResume);
      if (!candidateName) throw new Error('请在候选人信息中填写姓名，再生成推荐文案');
      if (!preferredCode && !pendingCandidateIdentity.current) pendingCandidateIdentity.current = crypto.randomUUID();
      const allocation = await allocateCandidateCode(
        owner,
        preferredCode,
        candidateName,
        preferredCode ? preferredCode === reservedCandidateCode ? reservedCandidateIdentityId || undefined : undefined
          : pendingCandidateIdentity.current,
      );
      if (isStale()) return;
      setReservedCandidateCode(allocation.code);
      setReservedCandidateIdentityId(allocation.candidateIdentityId);
      setRecommendationOwner(owner);
      const currentJds = selectedJDs.map(selected => useJDStore.getState().jds.find(jd => jd.id === selected.id && jd.status !== 'paused'));
      if (currentJds.some(jd => !jd)) throw new Error('所选岗位已关闭或移除，请重新选择目标岗位');
      const copies = currentJds.map((currentJd) => (
        buildRecommendationCopy(
          activeResume,
          info,
          currentJd!,
          candidateText,
          allocation.code,
          allocation.candidateIdentityId,
          candidateName,
          resumeSource,
          resumeFileName,
          owner,
          useOriginalResume,
        )
      ));
      setRecommendationCopies(copies);
      setCopyDialogInitialJdId(copies[0]?.jdId || '');
      setCopyDialogOpen(copies.length > 0);
      setCandidateDialogOpen(copies.length === 0);
    } catch (error) {
      if (isStale()) return;
      setCandidateCodeError(error instanceof Error ? error.message : '推荐文案生成失败，请重试');
      setCandidateDialogOpen(true);
    } finally {
      if (generation === recommendationGeneration.current) setIsGeneratingCopy(false);
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

      {rematchNotice && (
        <div className={cn(
          'flex items-center gap-3 rounded-xl border px-4 py-3 text-sm',
          rematchNotice.tone === 'error'
            ? 'border-rose-200 bg-rose-50 text-rose-700'
            : rematchNotice.tone === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-sky-200 bg-sky-50 text-sky-700',
        )}>
          {rematchNotice.tone === 'loading'
            ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
            : rematchNotice.tone === 'success'
              ? <CheckCircle2 className="h-4 w-4 shrink-0" />
              : <AlertCircle className="h-4 w-4 shrink-0" />}
          <span className="min-w-0 flex-1">{rematchNotice.text}</span>
          {rematchNotice.tone === 'loading' && (
            <button
              type="button"
              onClick={cancelAutomaticResumeLoad}
              className="shrink-0 rounded-lg border border-sky-200 bg-white px-3 py-1.5 text-xs font-semibold text-sky-700 transition-colors hover:bg-sky-100"
            >
              取消载入
            </button>
          )}
        </div>
      )}

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
              onClick={() => {
                setMatchCategory(cat);
                setTargetJDIds(new Set());
              }}
              disabled={isMatching}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-medium transition-all border',
                targetJDIds.size === 0 && matchCategory === cat
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
        {targetJDIds.size > 0 && (
          <div className="mt-3 flex items-center gap-2 border-t border-gray-100 pt-3 text-xs text-gray-500">
            <span className="shrink-0 text-indigo-600">本次仅匹配：</span>
            <span className="min-w-0 flex-1 truncate">
              {jds.filter((jd) => targetJDIds.has(jd.id)).map((jd) => jd.title).join('、')}
            </span>
            <button type="button" onClick={() => setTargetJDIds(new Set())} disabled={isMatching} className="shrink-0 text-gray-400 hover:text-gray-600 disabled:opacity-50">
              清除
            </button>
          </div>
        )}
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
              {targetJDIds.size > 0
                ? `开始匹配（指定 ${targetJDIds.size} 个岗位）`
                : matchCategory === 'all'
                  ? '开始匹配（全部）'
                  : `开始匹配（${JD_CATEGORY_LABELS[matchCategory as JDCategory]}）`}
            </button>
          )
        )}
        {!activeIsMatching && (
          <button
            type="button"
            onClick={() => setTargetJDPickerOpen(true)}
            disabled={isMatching}
            className={cn(
              'flex h-10 items-center gap-2 rounded-xl border px-4 text-sm font-medium transition-all',
              targetJDIds.size > 0
                ? 'border-indigo-500 bg-indigo-50 text-indigo-700 shadow-sm'
                : 'border-indigo-200 bg-white text-indigo-600 hover:bg-indigo-50',
              isMatching && 'opacity-50',
            )}
          >
            <ListChecks className="h-4 w-4" />
            指定岗位
            {targetJDIds.size > 0 && <span className="rounded-md bg-indigo-100 px-1.5 py-0.5 text-xs">{targetJDIds.size}</span>}
          </button>
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
            <span className="flex items-center gap-1.5 text-xs text-gray-400"><Clock className="w-3.5 h-3.5" />本页结果保留至主动清除或刷新</span>
          </>
        )}
      </div>

      {targetJDPickerOpen && (
        <TargetJDPickerDialog
          jds={jds}
          selectedIds={targetJDIds}
          currentCategory={matchCategory}
          disabled={isMatching}
          onClose={() => setTargetJDPickerOpen(false)}
          onConfirm={(ids) => {
            setTargetJDIds(ids);
            setSelectedResultIds((previous) => {
              const combinedJDIds = new Set(ids);
              const retained = new Set<string>();
              for (const result of activeResults) {
                if (!previous.has(result.id)) continue;
                if (combinedJDIds.has(result.jdId) || combinedJDIds.size < 10) {
                  retained.add(result.id);
                  combinedJDIds.add(result.jdId);
                }
              }
              return retained;
            });
            setRecommendationCopies([]);
            setCandidateDialogOpen(false);
            setCopyDialogOpen(false);
            setTargetJDPickerOpen(false);
          }}
        />
      )}

      {uploadError && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200">
          <AlertCircle className="w-5 h-5 text-amber-500 shrink-0" />
          <p className="text-sm text-amber-700 flex-1">{uploadError}</p>
        </div>
      )}

      {unavailableJdCount > 0 && <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">{unavailableJdCount} 个已勾选岗位已关闭或移除，请重新选择岗位后生成推荐。</p>}

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
          {activeBatch && <div className="mb-4 flex flex-wrap items-center gap-3 text-xs text-slate-500">
            <span>范围 {activeBatch.scopeIds?.length || 0} 岗 · 已评估 {activeResults.length - failedJobCount} · 分析失败 {failedJobCount} · 未深入评估 {remainingJobCount}{activeBatch.skipped ? ` · 无缺口跳过 ${activeBatch.skipped}` : ''}</span>
            {remainingJobCount > 0 && !activeIsMatching && <button type="button" disabled={isMatching} onClick={() => activeResumeId && void matchWithJDs(activeResumeId, matchCategory, undefined, 'next')} className="rounded-lg border border-indigo-200 px-3 py-2 text-indigo-600 disabled:opacity-50">{activeResults.length ? '分析更多相近岗位' : matchError ? '重试匹配' : '开始岗位分析'}</button>}
            {failedJobCount > 0 && <button type="button" disabled={isMatching} onClick={() => activeResumeId && void matchWithJDs(activeResumeId, matchCategory, undefined, 'retry')} className="rounded-lg border border-amber-200 px-3 py-2 text-amber-700 disabled:opacity-50">重试失败岗位</button>}
          </div>}
          {activeBatch?.profile && <div className="mb-4 rounded-xl border border-indigo-100 bg-indigo-50/50 p-4 text-sm">
            <p className="font-medium text-indigo-800">人选判断：{activeBatch.profile.primaryRole}</p>
            <p className="mt-2 text-slate-600">{activeBatch.profile.summary}</p>
            <div className="mt-2 flex flex-wrap gap-2">{activeBatch.profile.levels.map((item) => <span key={item.label} title={item.quote} className="rounded-md bg-white px-2 py-1 text-xs text-indigo-700">{item.label}</span>)}</div>
            <details className="mt-2 text-xs text-slate-500"><summary className="cursor-pointer">查看经历依据</summary>{activeBatch.profile.facts.map((item, index) => <p key={index} className="mt-2">{item.quote} → {item.meaning}</p>)}</details>
          </div>}
          <MatchingResultsList
            key={activeResumeId}
            results={activeResults}
            isMatching={activeIsMatching}
            refinementProgress={activeIsMatching ? { completed: activeBatch?.refinedCount || 0, total: activeBatch?.refineTotal || 0 } : null}
            selectedResultIds={selectedResultIds}
            recommendationSelectionCount={recommendationSelectionCount}
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
          jobCount={recommendationSelectionCount}
          codePrefix={OWNER_CONFIG[activeOwner].codePrefix}
          candidateCode={reservedCandidateCode}
          initialCandidateText={candidateInfoText}
          initialResumeFile={recommendationResumeFile || activeResume?.file || null}
          initialResumeSource={recommendationResumeSource}
          error={candidateCodeError}
          generating={isGeneratingCopy}
          hasExistingIdentity={Boolean(reservedCandidateCode || reservedCandidateIdentityId || pendingCandidateIdentity.current)}
          onClose={() => {
            recommendationGeneration.current += 1;
            setIsGeneratingCopy(false);
            setCandidateDialogOpen(false);
          }}
          onGenerate={handleGenerateRecommendationCopy}
        />
      )}
      {copyDialogOpen && recommendationCopies.length > 0 && (
        <RecommendationCopyDialog
          owner={recommendationOwner || activeOwner}
          items={recommendationCopies}
          initialJdId={copyDialogInitialJdId}
          resumeFile={recommendationResumeFile}
          resumeFileName={recommendationResumeFile?.name || activeResume?.fileName || 'resume.pdf'}
          resumeBlobUrl={recommendationResumeBlobUrl}
          validateBeforeSend={(copies) => {
            const currentJds = useJDStore.getState().jds;
            if (copies.some(copy => !currentJds.some(jd => jd.id === copy.jdId && jd.status !== 'paused'
              && jd.title === copy.title && recommendationOrganization(jd) === copy.organization
              && String(jd.department || '').trim() === copy.department
              && String(jd.odc || '').trim() === copy.contactPerson))) {
              throw new Error('岗位已关闭、移除或对接信息已更新，请重新生成推荐文案后发送');
            }
          }}
          onResumeBlobReady={(url) => {
            if (useResumeStore.getState().activeResumeId === activeResumeId
              && usePrefStore.getState().activeOwner === activeOwner) setRecommendationResumeBlobUrl(url);
          }}
          onDeliveryUpdate={(deliveryItems, delivery: RecommendationDeliverySnapshot, fileUrl) => {
            if (!delivery.id) return;
            const applications = new Map((delivery.applications || []).map((application) => [application.index, application]));
            const records = new Map((delivery.records || []).map((record) => [record.deliveryIndex, record]));
            if (records.size > 0) {
              applyRemoteStoreUpdate('repush', () => {
                for (const record of Array.from(records.values())) upsertDeliveryRecommendation(record);
                return useRepushStore.getState().items;
              });
            }
            for (const result of delivery.deliveries || []) {
              const copy = deliveryItems[result.index];
              if (!copy) continue;
              const authoritativeRecord = records.get(result.index);
              if (authoritativeRecord) continue;
              const application = applications.get(result.index);
              const deliveryStatus: RecommendationDeliveryStatus = result?.status === 'sent' || result?.messageId
                ? 'sent'
                : result?.status === 'failed'
                  ? 'failed'
                  : result?.status === 'sending'
                    ? 'sending'
                    : 'queued';
              addRecommendation({
                applicationId: application?.applicationId || `${delivery.id}:${copy.jdId}`,
                column: recommendationOwner || activeOwner,
                candidateCode: copy.candidateCode,
                candidateIdentityId: copy.candidateIdentityId,
                candidateName: copy.candidateName,
                jdId: copy.jdId,
                jdTitle: copy.title,
                contact: copy.contact,
                contactPerson: copy.contactPerson,
                rawText: copy.text,
                organization: copy.organization,
                department: copy.department,
                resumeUrl: fileUrl,
                resumeFileName: recommendationResumeFile?.name || activeResume?.fileName,
                source: 'intake',
                deliveryId: delivery.id,
                deliveryIndex: result.index,
                deliveryStatus,
                deliveryUpdatedAt: delivery.updatedAt,
                telegramMessageId: result?.messageId,
                deliveredAt: result?.sentAt,
                uploadedAt: delivery.createdAt,
                updatedAt: delivery.createdAt,
              });
            }
          }}
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
