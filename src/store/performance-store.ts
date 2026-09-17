import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CandidateOwner } from '@/types/interview';

export interface PerformanceKpiRecord {
  id: string;
  owner: CandidateOwner;
  month: string;
  positionSalary?: number;
  kpiScore?: number;
  updatedAt: string;
}

interface PerformanceStore {
  records: PerformanceKpiRecord[];
  updateRecord: (
    owner: CandidateOwner,
    month: string,
    partial: Partial<Pick<PerformanceKpiRecord, 'positionSalary' | 'kpiScore'>>,
  ) => void;
}

export const usePerformanceStore = create<PerformanceStore>()(
  persist(
    (set) => ({
      records: [],
      updateRecord: (owner, month, partial) => set((state) => {
        const id = `${owner}:${month}`;
        const existing = state.records.find((record) => record.id === id);
        const salaryUnchanged = !Object.hasOwn(partial, 'positionSalary')
          || existing?.positionSalary === partial.positionSalary;
        const scoreUnchanged = !Object.hasOwn(partial, 'kpiScore')
          || existing?.kpiScore === partial.kpiScore;
        if (existing && salaryUnchanged && scoreUnchanged) return state;
        const updated: PerformanceKpiRecord = {
          id,
          owner,
          month,
          ...existing,
          ...partial,
          updatedAt: new Date().toISOString(),
        };
        return {
          records: existing
            ? state.records.map((record) => record.id === id ? updated : record)
            : [...state.records, updated],
        };
      }),
    }),
    { name: 'recruitai-performance-store', version: 1 },
  ),
);
