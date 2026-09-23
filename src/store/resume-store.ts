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
const uploadedResumeBlobs = new WeakMap<File, string>();
const pendingResumeUploads = new WeakMap<File, Promise<string>>();

async function withResumeTimeout<T>(milliseconds: number, message: string, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = Object.assign(new Error(message), { name: 'TimeoutError' });
      reject(error);
      controller.abort();
    }, milliseconds);
  });
  try { return await Promise.race([operation(controller.signal), deadline]); }
  finally { clearTimeout(timer!); }
}

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
  restoreParsedResume: (input: { fileName: string; rawText: string; blobUrl?: string; candidateName?: string }) => string;
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

  uploadResume: (file: File) => {
    const pending = pendingResumeUploads.get(file);
    if (pending) return pending;
    const existing = get().resumes.find(resume => resume.file === file && resume.parsingStatus === 'failed');
    if (!existing && get().resumes.length >= MAX_RESUMES) {
      set({ uploadError: `最多同时保留 ${MAX_RESUMES} 份简历，请先删除部分简历` });
      return Promise.resolve('');
    }
    set({ isUploading: true, uploadError: null });
    const id = existing?.id || generateId();
    const lowerName = file.name.toLowerCase();
    const fileType: Resume['fileType'] = lowerName.endsWith('.pdf')
      ? 'pdf'
      : /\.(jpe?g|png|webp|gif)$/.test(lowerName) ? 'image' : 'docx';

    const resume: Resume = {
      id, fileName: file.name, fileType, rawText: '',
      parsedData: { skills: [], experience: [], education: [] },
      uploadedAt: new Date().toISOString(), parsingStatus: 'parsing',
      file, // 保留原始文件（内存），供后续「存入人才库/录入推荐」把文件本体传 Blob
      blobUrl: existing?.blobUrl || uploadedResumeBlobs.get(file),
    };

    set((s) => ({ resumes: existing ? s.resumes.map(r => r.id === id ? resume : r) : [...s.resumes, resume], activeResumeId: id }));
    const finish = (patch: Partial<Resume>) => set(s => {
      const resumes = s.resumes.map(r => r.id === id ? { ...r, ...patch } : r);
      return { resumes, isUploading: resumes.some(r => r.parsingStatus === 'parsing') };
    });

    const work = (async () => { try {
      if (!file.size || file.size > 50 * 1024 * 1024) throw new Error(file.size ? '简历超过 50MB，请压缩后重试' : '简历文件为空，请重新选择');
      // 大文件（>4MB）经 Vercel Blob 客户端直传后再让服务端拉取解析，
      // 绕过 Serverless 4.5MB 请求体上限；小文件走更快的 FormData 直传路径。
      const LARGE_FILE_BYTES = 4 * 1024 * 1024;
      let blobUrl = resume.blobUrl;
      if (!blobUrl && file.size > LARGE_FILE_BYTES) {
        blobUrl = await withResumeTimeout(60_000, '上传超时，原文件已保留，请点重试', async signal => {
          const { upload } = await import('@vercel/blob/client');
          if (signal.aborted) throw new Error('上传已超时，请点重试');
          const blob = await upload(file.name, file, {
            access: 'public', handleUploadUrl: '/api/resume/blob-upload',
            contentType: file.type || 'application/octet-stream', abortSignal: signal,
          });
          // Exact File identity: UI retry can remove/re-add the row without losing
          // the confirmed upload or accidentally reusing another same-name file.
          uploadedResumeBlobs.set(file, blob.url);
          set(s => ({ resumes: s.resumes.map(r => r.id === id ? { ...r, blobUrl: blob.url } : r) }));
          return blob.url;
        });
      }
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const data = await withResumeTimeout(65_000, '识别超时，原文件和已上传附件已保留，请点重试', async signal => {
            const form = new FormData();
            if (!blobUrl) form.append('file', file);
            const res = await fetch('/api/resume/parse', blobUrl ? {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url: blobUrl, fileName: file.name }), signal,
            } : { method: 'POST', body: form, signal });
            // Include response-body reading in the deadline/retry boundary.
            const raw = await res.text();
            if (!res.ok) throw Object.assign(aiHttpError(res.status, raw), {
              retryable: [408, 429, 502, 503, 504].includes(res.status),
            });
            try { return JSON.parse(raw) as { text?: string; source?: string; error?: string }; }
            catch { throw new Error('识别结果传输不完整，请点重试'); }
          });
          if (data?.error || typeof data?.text !== 'string' || !data.text.trim()) {
            throw Object.assign(new Error(data?.error || '简历正文为空，无法解析'), { retryable: false });
          }
          finish({ rawText: data.text, parseSource: data.source, parsingStatus: 'completed', parseError: undefined });
          return id;
        } catch (error) {
          if (attempt === 1 || (error as { retryable?: boolean }).retryable === false
            || (error as Error).name === 'TimeoutError') throw error;
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
    } catch (err) {
      const error = err as Error;
      const errMsg = error.name === 'TypeError' || error.name === 'AbortError'
        ? '网络连接中断，原文件已保留，请点重试' : error.message || '上传或识别失败，请点重试';
      finish({ parsingStatus: 'failed', parseError: errMsg });
    }
    return id;
    })();
    pendingResumeUploads.set(file, work);
    void work.finally(() => pendingResumeUploads.delete(file));
    return work;
  },

  restoreParsedResume: ({ fileName, rawText, blobUrl, candidateName }) => {
    const text = rawText.trim();
    if (!text) return '';
    const existing = get().resumes.find((resume) => (
      resume.parsingStatus === 'completed'
      && (blobUrl ? resume.blobUrl === blobUrl : resume.fileName === fileName)
    ));
    if (existing) {
      set({ activeResumeId: existing.id, uploadError: null });
      return existing.id;
    }
    if (get().resumes.length >= MAX_RESUMES) {
      set({ uploadError: `最多同时保留 ${MAX_RESUMES} 份简历，请先删除部分简历` });
      return '';
    }
    const id = generateId();
    const lowerName = fileName.toLowerCase();
    const fileType: Resume['fileType'] = lowerName.endsWith('.pdf')
      ? 'pdf'
      : /\.(jpe?g|png|webp|gif)$/.test(lowerName) ? 'image' : 'docx';
    const resume: Resume = {
      id,
      fileName,
      fileType,
      rawText: text,
      parsedData: { name: candidateName?.trim() || undefined, skills: [], experience: [], education: [] },
      uploadedAt: new Date().toISOString(),
      parsingStatus: 'completed',
      parseSource: 'saved-text',
      blobUrl,
    };
    set((state) => ({ resumes: [...state.resumes, resume], activeResumeId: id, uploadError: null }));
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
