import { create } from 'zustand';
import type { Resume } from '@/types/resume';
import type { JDCategory } from '@/types/jd';
import { hasCategory } from '@/types/jd';
import type { MatchingResult } from '@/types/matching';
import { generateId } from '@/lib/utils';
import { matchResumeToJDsStream } from '@/lib/deepseek';
import { useJDStore } from './jd-store';

interface ResumeStore {
  resumes: Resume[];
  activeResumeId: string | null;
  matchingResults: MatchingResult[];
  isUploading: boolean;
  isMatching: boolean;
  matchError: string | null;
  abortController: AbortController | null;

  uploadResume: (file: File) => Promise<string>;
  setActiveResume: (id: string | null) => void;
  matchWithJDs: (resumeId: string, category?: JDCategory | 'all') => Promise<void>;
  cancelMatching: () => void;
  clearMatches: () => void;
  removeResume: (id: string) => void;
}

export const useResumeStore = create<ResumeStore>((set, get) => ({
  resumes: [],
  activeResumeId: null,
  matchingResults: [],
  isUploading: false,
  isMatching: false,
  matchError: null,
  abortController: null,

  uploadResume: async (file: File) => {
    set({ isUploading: true });
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
    set({ isMatching: true, matchingResults: [], matchError: null, abortController: ac });

    try {
      const resume = get().resumes.find((r) => r.id === resumeId);
      if (!resume) { set({ isMatching: false }); return; }

      const { jds } = useJDStore.getState();
      let activeJds = jds.filter((j) => j.status !== 'paused');
      if (category !== 'all') {
        activeJds = activeJds.filter((j) => hasCategory(j, category));
      }
      if (activeJds.length === 0) {
        set({ isMatching: false, matchError: '没有活跃的 JD 可匹配' });
        return;
      }

      // 流式：结果逐条到达即追加并按分数排序，体感更快
      await matchResumeToJDsStream(resume.rawText, activeJds, resumeId, (result) => {
        if (ac.signal.aborted) return;
        set((s) => ({
          matchingResults: [...s.matchingResults, result].sort((a, b) => b.score - a.score),
        }));
      }, ac.signal);

      if (!ac.signal.aborted) {
        set((s) => ({ matchingResults: s.matchingResults.slice(0, 5), isMatching: false, abortController: null }));
      }
    } catch (err) {
      if (!ac.signal.aborted) {
        set({
          isMatching: false,
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
      set({ isMatching: false, abortController: null, matchError: '匹配已取消' });
    }
  },

  clearMatches: () => set({ matchingResults: [], matchError: null }),

  removeResume: (id) =>
    set((s) => ({
      resumes: s.resumes.filter((r) => r.id !== id),
      activeResumeId: s.activeResumeId === id ? null : s.activeResumeId,
    })),
}));
