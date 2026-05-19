import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Candidate, CandidateStatus, InterviewStage } from '@/types/interview';
import { generateId } from '@/lib/utils';

const MOCK_CANDIDATES: Candidate[] = [
  { id: 'c-001', name: '张伟', resumeId: 'r-001', jdId: 'jd-001', jdTitle: '高级前端工程师', stage: 'interview-2', score: 88,
    interviewDate: new Date(Date.now() + 3 * 60 * 1000).toISOString(), interviewer: '王经理', contactEmail: 'zhangwei@email.com',
    notes: '技术能力强，React经验丰富', appliedAt: '2026-05-08T00:00:00Z', updatedAt: '2026-05-12T00:00:00Z' },
  { id: 'c-002', name: '李娜', resumeId: 'r-002', jdId: 'jd-006', jdTitle: '高级后端工程师', stage: 'interview-1', score: 82,
    contactEmail: 'lina@email.com', appliedAt: '2026-05-10T00:00:00Z', updatedAt: '2026-05-10T00:00:00Z' },
  { id: 'c-003', name: '陈晓', resumeId: 'r-003', jdId: 'jd-018', jdTitle: '技术总监', stage: 'offer', score: 93,
    interviewDate: '2026-05-09T09:00:00Z', interviewer: '刘VP', contactEmail: 'chenxiao@email.com',
    notes: '10年技术管理经验', appliedAt: '2026-04-28T00:00:00Z', updatedAt: '2026-05-10T00:00:00Z' },
];

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
