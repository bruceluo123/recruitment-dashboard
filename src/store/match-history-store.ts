import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { generateId } from '@/lib/utils';
import type { TalentMatchResult } from '@/types/talent-match';

/**
 * 一次 JD→人才匹配的历史快照。仅存 localStorage（不进 KV 多人同步），
 * 供本机复看，避免退出/刷新后需要重新跑一遍匹配。
 */
export interface MatchHistoryRecord {
  id: string;
  savedAt: string;          // ISO 时间戳
  jdTitle: string;          // 岗位名称
  jdSubtitle: string;       // 「部门 · 编制」或「粘贴 JD 文本」
  mode: 'library' | 'paste';
  talentTotal: number;      // 匹配时人才库总数
  scannedCount: number;     // 匹配时已扫描简历正文数
  results: TalentMatchResult[];
}

// 仅保留最近 N 条，防止 localStorage 膨胀（每条含若干候选人快照）
const MAX_HISTORY = 5;

interface MatchHistoryStore {
  history: MatchHistoryRecord[];
  addRecord: (rec: Omit<MatchHistoryRecord, 'id' | 'savedAt'>) => MatchHistoryRecord;
  removeRecord: (id: string) => void;
  clearHistory: () => void;
}

export const useMatchHistoryStore = create<MatchHistoryStore>()(
  persist(
    (set) => ({
      history: [],
      addRecord: (rec) => {
        const record: MatchHistoryRecord = { ...rec, id: generateId(), savedAt: new Date().toISOString() };
        set((s) => ({ history: [record, ...s.history].slice(0, MAX_HISTORY) }));
        return record;
      },
      removeRecord: (id) => set((s) => ({ history: s.history.filter((r) => r.id !== id) })),
      clearHistory: () => set({ history: [] }),
    }),
    { name: 'recruitai-match-history', version: 1 },
  ),
);
