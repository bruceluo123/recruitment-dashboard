import { create } from 'zustand';
import type { Resume } from '@/types/resume';
import type { JDCategory } from '@/types/jd';
import type { MatchingResult } from '@/types/matching';
import { generateId } from '@/lib/utils';
import { matchResumeToJDs } from '@/lib/deepseek';
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
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/resume/parse', { method: 'POST', body: formData });
      const data = await res.json();
      set((s) => ({
        isUploading: false,
        resumes: s.resumes.map((r) =>
          r.id === id ? { ...r, rawText: data.text || '', parsingStatus: 'completed' as const } : r),
      }));
    } catch {
      set((s) => ({
        isUploading: false,
        resumes: s.resumes.map((r) => r.id === id ? { ...r, parsingStatus: 'failed' as const } : r),
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
        activeJds = activeJds.filter((j) => j.category === category);
      }
      if (activeJds.length === 0) {
        set({ isMatching: false, matchError: '没有活跃的 JD 可匹配' });
        return;
      }

      const results = await matchResumeToJDs(resume.rawText, activeJds, resumeId, ac.signal);
      if (!ac.signal.aborted) {
        set({ matchingResults: results.slice(0, 5), isMatching: false, abortController: null });
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
