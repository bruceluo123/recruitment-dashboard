import { create } from 'zustand';
import type { Resume } from '@/types/resume';
import type { JDCategory } from '@/types/jd';
import { hasCategory } from '@/types/jd';
import type { CandidateAssessment, MatchingResult } from '@/types/matching';
import { generateId } from '@/lib/utils';
import { hasOpenGap, matchResumeToJDsStream } from '@/lib/deepseek';
import { aiHttpError } from '@/lib/ai-fetch';
import { useJDStore } from './jd-store';

// 同时最多保留的简历数；结果保留到主动清除或关闭页面。
export const MAX_RESUMES = 5;

/** 单份简历的一次稳定匹配结果 */
export interface MatchBatch {
  results: MatchingResult[];
  matchedAt: number;
  scopeIds?: string[];
  skipped?: number;
  phase?: 'profiling' | 'evaluating' | 'completed';
  profile?: CandidateAssessment;
  refinedCount?: number;
  refineTotal?: number;
}

interface ResumeStore {
  resumes: Resume[];
  activeResumeId: string | null;
  resultsByResume: Record<string, MatchBatch>; // 按简历 id 分别保存匹配结果
  isUploading: boolean;
  isMatching: boolean;
  matchingResumeId: string | null;             // 正在匹配的简历（其结果不会被 TTL 清除）
  matchError: string | null;
  uploadError: string | null;
  abortController: AbortController | null;

  uploadResume: (file: File) => Promise<string>;
  setActiveResume: (id: string | null) => void;
  matchWithJDs: (resumeId: string, category?: JDCategory | 'all', jdIds?: string[], mode?: 'reset' | 'next' | 'retry') => Promise<void>;
  cancelMatching: () => void;
  clearMatchesFor: (resumeId: string) => void;
  removeResume: (id: string) => void;
}

export const useResumeStore = create<ResumeStore>((set, get) => ({
  resumes: [],
  activeResumeId: null,
  resultsByResume: {},
  isUploading: false,
  isMatching: false,
  matchingResumeId: null,
  matchError: null,
  uploadError: null,
  abortController: null,

  uploadResume: async (file: File) => {
    if (get().resumes.length >= MAX_RESUMES) {
      set({ uploadError: `最多同时保留 ${MAX_RESUMES} 份简历，请先删除部分简历` });
      return '';
    }
    set({ isUploading: true, uploadError: null });
    const id = generateId();
    const lowerName = file.name.toLowerCase();
    const fileType: Resume['fileType'] = lowerName.endsWith('.pdf')
      ? 'pdf'
      : /\.(jpe?g|png|webp|gif)$/.test(lowerName) ? 'image' : 'docx';

    const resume: Resume = {
      id, fileName: file.name, fileType, rawText: '',
      parsedData: { skills: [], experience: [], education: [] },
      uploadedAt: new Date().toISOString(), parsingStatus: 'parsing',
      file, // 保留原始文件（内存），供后续「存入人才库/录入推荐」把文件本体传 Blob
    };

    set((s) => ({ resumes: [...s.resumes, resume], activeResumeId: id }));

    try {
      // 大文件（>4MB）经 Vercel Blob 客户端直传后再让服务端拉取解析，
      // 绕过 Serverless 4.5MB 请求体上限；小文件走更快的 FormData 直传路径。
      const LARGE_FILE_BYTES = 4 * 1024 * 1024;
      let parseRequest: () => Promise<Response>;
      if (file.size > LARGE_FILE_BYTES) {
        const { upload } = await import('@vercel/blob/client');
        const blob = await upload(file.name, file, {
          access: 'public',
          handleUploadUrl: '/api/resume/blob-upload',
          contentType: file.type || 'application/octet-stream',
        });
        // 大文件已入 Blob：记下链接，「存入人才库/录入推荐」直接复用无需再传
        set((s) => ({ resumes: s.resumes.map((r) => r.id === id ? { ...r, blobUrl: blob.url } : r) }));
        parseRequest = () => fetch('/api/resume/parse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: blob.url, fileName: file.name }),
        });
      } else {
        const formData = new FormData();
        formData.append('file', file);
        parseRequest = () => fetch('/api/resume/parse', { method: 'POST', body: formData });
      }
      let res = await parseRequest();
      if ([502, 503, 504].includes(res.status)) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        res = await parseRequest();
      }
      // 先按状态处理（413 等非 JSON 错误在此转成可读文案，避免 res.json() 抛 Unexpected token）
      if (!res.ok) {
        const errMsg = aiHttpError(res.status, await res.text().catch(() => '')).message;
        set((s) => ({
          isUploading: false,
          resumes: s.resumes.map((r) => r.id === id ? { ...r, parsingStatus: 'failed' as const, parseError: errMsg } : r),
        }));
        return id;
      }
      const data = await res.json().catch(() => ({} as { text?: string; source?: string; error?: string }));
      // 解析失败（如图片型 PDF 无法识别）或正文为空 → 标记失败，保留错误信息
      if (data.error || !data.text) {
        const errMsg = data.error || '简历正文为空，无法解析';
        set((s) => ({
          isUploading: false,
          resumes: s.resumes.map((r) => r.id === id ? { ...r, parsingStatus: 'failed' as const, parseError: errMsg } : r),
        }));
        return id;
      }
      set((s) => ({
        isUploading: false,
        resumes: s.resumes.map((r) =>
          r.id === id ? { ...r, rawText: data.text, parseSource: data.source, parsingStatus: 'completed' as const } : r),
      }));
    } catch (err) {
      const errMsg = `上传失败：${(err as Error).message || '网络异常，请重试'}`;
      set((s) => ({
        isUploading: false,
        resumes: s.resumes.map((r) => r.id === id ? { ...r, parsingStatus: 'failed' as const, parseError: errMsg } : r),
      }));
    }
    return id;
  },

  setActiveResume: (id) => set({ activeResumeId: id }),

  matchWithJDs: async (resumeId: string, category: JDCategory | 'all' = 'all', jdIds?: string[], mode = 'reset') => {
    if (get().isMatching) return;
    const previous = get().resultsByResume[resumeId];
    const ac = new AbortController();
    set((s) => ({
      isMatching: true,
      matchingResumeId: resumeId,
      matchError: null,
      abortController: ac,
      // 该简历重新匹配前清空它自己的旧结果（不影响其它简历）
      resultsByResume: { ...s.resultsByResume, [resumeId]: {
        ...(mode !== 'reset' && previous ? previous : { results: [], matchedAt: Date.now() }),
        phase: 'profiling',
        refinedCount: 0,
        refineTotal: 0,
      } },
    }));

    try {
      const resume = get().resumes.find((r) => r.id === resumeId);
      if (!resume || resume.parsingStatus !== 'completed' || !resume.rawText.trim()) throw new Error('请先完成简历识别');

      const { jds } = useJDStore.getState();
      let activeJds = jds.filter((j) => j.status !== 'paused');
      if (mode !== 'reset' && previous?.scopeIds) {
        const scopeIds = new Set(previous.scopeIds);
        activeJds = activeJds.filter((j) => scopeIds.has(j.id));
      } else if (jdIds?.length) {
        const targetIds = new Set(jdIds);
        activeJds = activeJds.filter((j) => targetIds.has(j.id));
      } else if (category !== 'all') {
        activeJds = activeJds.filter((j) => hasCategory(j, category));
      }
      const skipped = activeJds.filter((jd) => !hasOpenGap(jd)).length;
      activeJds = activeJds.filter(hasOpenGap);
      set((s) => ({ resultsByResume: { ...s.resultsByResume, [resumeId]: {
        ...s.resultsByResume[resumeId], scopeIds: activeJds.map((jd) => jd.id), skipped,
      } } }));
      if (mode !== 'reset') {
        const analysed = new Map(previous?.results.map((result) => [result.jdId, result]));
        activeJds = activeJds.filter((jd) => mode === 'retry' ? analysed.get(jd.id)?.assessmentStatus === 'failed' : !analysed.has(jd.id));
      }
      if (activeJds.length === 0) {
        set({ isMatching: false, matchingResumeId: null, abortController: null, matchError: skipped ? '该范围的岗位已无招聘缺口，已跳过' : '当前范围没有待分析岗位' });
        return;
      }

      // 整轮分析完成后一次写入，进度更新不会修改结果列表。
      await matchResumeToJDsStream(resume.rawText, activeJds, resumeId, (value) => {
        if (ac.signal.aborted) return;
        set((s) => {
          const incoming = Array.isArray(value) ? value : [value];
          const incomingIds = new Set(incoming.map((result) => result.jdId));
          const prev = s.resultsByResume[resumeId]?.results || [];
          if (!s.resumes.some((item) => item.id === resumeId)) return {};
          const next = [...prev.filter((item) => !incomingIds.has(item.jdId)), ...incoming].sort((a, b) => b.score - a.score);
          return { resultsByResume: { ...s.resultsByResume, [resumeId]: { ...s.resultsByResume[resumeId], results: next, matchedAt: Date.now() } } };
        });
      }, ac.signal, (progress) => {
        if (ac.signal.aborted) return;
        set((s) => {
          const batch = s.resultsByResume[resumeId];
          if (!batch || !s.resumes.some((item) => item.id === resumeId)) return {};
          return { resultsByResume: { ...s.resultsByResume, [resumeId]: {
            ...batch,
            phase: progress.stage,
            refinedCount: progress.completed,
            refineTotal: progress.total,
            profile: progress.profile || batch.profile,
          } } };
        });
      });

      if (!ac.signal.aborted) {
        set({ isMatching: false, matchingResumeId: null, abortController: null });
      }
    } catch (err) {
      if (!ac.signal.aborted) {
        set({
          isMatching: false,
          matchingResumeId: null,
          matchError: (err as Error).message || '匹配失败，请重试',
          abortController: null,
        });
      }
    }
  },

  cancelMatching: () => {
    const { abortController } = get();
    if (abortController) {
      abortController.abort();
      set({ isMatching: false, matchingResumeId: null, abortController: null, matchError: '匹配已取消' });
    }
  },

  clearMatchesFor: (resumeId) =>
    set((s) => {
      if (!s.resultsByResume[resumeId]) return {};
      const next = { ...s.resultsByResume };
      delete next[resumeId];
      return { resultsByResume: next, matchError: null };
    }),

  removeResume: (id) =>
    set((s) => {
      const next = { ...s.resultsByResume };
      delete next[id];
      return {
        resumes: s.resumes.filter((r) => r.id !== id),
        activeResumeId: s.activeResumeId === id ? null : s.activeResumeId,
        resultsByResume: next,
      };
    }),
}));
