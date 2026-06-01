import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Candidate, CandidateStatus, InterviewStage } from '@/types/interview';
import { generateId } from '@/lib/utils';

// 候选人均为真实数据，由 KV 同步。不再注入示例（避免假数据「张伟」等触发假面试提醒）。
const MOCK_CANDIDATES: Candidate[] = [];

interface InterviewStore {
  candidates: Candidate[];
  customStages: InterviewStage[];
  moveCandidate: (id: string, toStage: CandidateStatus) => void;
  addCandidate: (c: Omit<Candidate, 'id' | 'appliedAt' | 'updatedAt'>) => void;
  updateCandidate: (id: string, partial: Partial<Candidate>) => void;
  removeCandidate: (id: string) => void;
  undoDeleteCandidate: () => void;
  lastDeletedCandidate: Candidate | null;
}

export const useInterviewStore = create<InterviewStore>()(
  persist(
    (set) => ({
      candidates: MOCK_CANDIDATES,
      customStages: [],
      moveCandidate: (id, toStage) => set((s) => ({
        candidates: s.candidates.map((c) =>
          c.id === id ? { ...c, stage: toStage, updatedAt: new Date().toISOString() } : c),
      })),
      addCandidate: (c) => set((s) => ({
        candidates: [...s.candidates, { ...c, id: generateId(), appliedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
      })),
      updateCandidate: (id, partial) => set((s) => ({
        candidates: s.candidates.map((c) =>
          c.id === id ? { ...c, ...partial, updatedAt: new Date().toISOString() } : c),
      })),
      removeCandidate: (id) => set((s) => {
        const target = s.candidates.find((c) => c.id === id);
        return { candidates: s.candidates.filter((c) => c.id !== id), lastDeletedCandidate: target || null };
      }),
      undoDeleteCandidate: () => set((s) => {
        if (!s.lastDeletedCandidate) return {};
        return { candidates: [...s.candidates, s.lastDeletedCandidate], lastDeletedCandidate: null };
      }),
      lastDeletedCandidate: null,
    }),
    { name: 'recruitai-interview-store' },
  ),
);
