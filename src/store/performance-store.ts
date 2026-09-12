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
    partial: Pick<PerformanceKpiRecord, 'positionSalary' | 'kpiScore'>,
  ) => void;
}

export const usePerformanceStore = create<PerformanceStore>()(
  persist(
    (set) => ({
      records: [],
      updateRecord: (owner, month, partial) => set((state) => {
        const id = `${owner}:${month}`;
        const existing = state.records.find((record) => record.id === id);
        if (existing
          && existing.positionSalary === partial.positionSalary
          && existing.kpiScore === partial.kpiScore) return state;
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
