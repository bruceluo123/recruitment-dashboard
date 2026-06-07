import { create } from 'zustand';
import type { Resume } from '@/types/resume';
import type { JDCategory } from '@/types/jd';
import { hasCategory } from '@/types/jd';
import type { MatchingResult } from '@/types/matching';
import { generateId } from '@/lib/utils';
import { matchResumeToJDsStream } from '@/lib/deepseek';
import { useJDStore } from './jd-store';

// 同时最多保留的简历数；匹配结果在完成后保留的时长（10 分钟）
export const MAX_RESUMES = 5;
export const MATCH_TTL_MS = 10 * 60 * 1000;

/** 单份简历的一次匹配结果及其时间戳（用于 10 分钟自动清除） */
export interface MatchBatch {
  results: MatchingResult[];
  matchedAt: number;
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
  matchWithJDs: (resumeId: string, category?: JDCategory | 'all') => Promise<void>;
  cancelMatching: () => void;
  clearMatchesFor: (resumeId: string) => void;
  pruneExpired: () => void;
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
    const fileType = file.name.endsWith('.pdf') ? 'pdf' : 'docx';

    const resume: Resume = {
      id, fileName: file.name, fileType, rawText: '',
      parsedData: { skills: [], experience: [], education: [] },
      uploadedAt: new Date().toISOString(), parsingStatus: 'parsing',
    };

    set((s) => ({ resumes: [...s.resumes, resume], activeResumeId: id }));

    try {
      // 大文件（>4MB）经 Vercel Blob 客户端直传后再让服务端拉取解析，
      // 绕过 Serverless 4.5MB 请求体上限；小文件走更快的 FormData 直传路径。
      const LARGE_FILE_BYTES = 4 * 1024 * 1024;
      let res: Response;
      if (file.size > LARGE_FILE_BYTES) {
        const { upload } = await import('@vercel/blob/client');
        const blob = await upload(file.name, file, {
          access: 'public',
          handleUploadUrl: '/api/resume/blob-upload',
          contentType: file.type || 'application/octet-stream',
        });
        res = await fetch('/api/resume/parse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: blob.url, fileName: file.name }),
        });
      } else {
        const formData = new FormData();
        formData.append('file', file);
        res = await fetch('/api/resume/parse', { method: 'POST', body: formData });
      }
      const data = await res.json();
      // 解析失败（如图片型 PDF 无法识别）或正文为空 → 标记失败，保留错误信息
      if (!res.ok || data.error || !data.text) {
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
          r.id === id ? { ...r, rawText: data.text, parsingStatus: 'completed' as const } : r),
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

  matchWithJDs: async (resumeId: string, category: JDCategory | 'all' = 'all') => {
    const ac = new AbortController();
    set((s) => ({
      isMatching: true,
      matchingResumeId: resumeId,
      matchError: null,
      abortController: ac,
      // 该简历重新匹配前清空它自己的旧结果（不影响其它简历）
      resultsByResume: { ...s.resultsByResume, [resumeId]: { results: [], matchedAt: Date.now() } },
    }));

    try {
      const resume = get().resumes.find((r) => r.id === resumeId);
      if (!resume) { set({ isMatching: false, matchingResumeId: null }); return; }

      const { jds } = useJDStore.getState();
      let activeJds = jds.filter((j) => j.status !== 'paused');
      if (category !== 'all') {
        activeJds = activeJds.filter((j) => hasCategory(j, category));
      }
      if (activeJds.length === 0) {
        set({ isMatching: false, matchingResumeId: null, matchError: '没有活跃的 JD 可匹配' });
        return;
      }

      // 流式：结果逐条到达即追加到该简历的批次并按分数排序
      await matchResumeToJDsStream(resume.rawText, activeJds, resumeId, (result) => {
        if (ac.signal.aborted) return;
        set((s) => {
          const prev = s.resultsByResume[resumeId]?.results || [];
          const next = [...prev, result].sort((a, b) => b.score - a.score).slice(0, 5);
          return { resultsByResume: { ...s.resultsByResume, [resumeId]: { results: next, matchedAt: Date.now() } } };
        });
      }, ac.signal);

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

  // 清除超过 TTL 的匹配结果（正在匹配的简历跳过）
  pruneExpired: () =>
    set((s) => {
      const now = Date.now();
      const next: Record<string, MatchBatch> = {};
      let changed = false;
      for (const [rid, batch] of Object.entries(s.resultsByResume)) {
        if (rid === s.matchingResumeId || now - batch.matchedAt < MATCH_TTL_MS) {
          next[rid] = batch;
        } else {
          changed = true;
        }
      }
      return changed ? { resultsByResume: next } : {};
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
