import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { generateId } from '@/lib/utils';

// 回收站（本机、30 天）：删除 JD/人才时在本地留一份完整副本，供误删后恢复。
// 刻意「不」经 KV 同步 —— 这是每台设备的安全网，且避免再碰刚出过事故的墓碑/同步机制。
// ⚠️ 恢复时必须赋「新 id」：被删项的原 id 已写入 KV 墓碑，用原 id 恢复会被 applyTombstones 再次过滤掉。

export type RecycleType = 'jd' | 'talent';

export interface RecycleEntry {
  key: string;          // 回收站条目唯一键
  type: RecycleType;
  label: string;        // 展示名（jd.title / talent.name）
  data: unknown;        // 原始完整数据（恢复用）
  deletedBy: string;    // 删除人（当前操作身份）
  deletedAt: string;
}

const RETAIN_MS = 30 * 24 * 60 * 60 * 1000; // 保留 30 天

interface RecycleStore {
  entries: RecycleEntry[];
  push: (type: RecycleType, deletedBy: string, items: Array<{ label: string; data: unknown }>) => void;
  remove: (key: string) => void;
  clearType: (type: RecycleType) => void;
}

export const useRecycleStore = create<RecycleStore>()(
  persist(
    (set) => ({
      entries: [],
      push: (type, deletedBy, items) => set((s) => ({
        entries: [
          ...items.map((it) => ({
            key: generateId(), type, label: it.label, data: it.data,
            deletedBy, deletedAt: new Date().toISOString(),
          })),
          ...s.entries,
        ],
      })),
      remove: (key) => set((s) => ({ entries: s.entries.filter((e) => e.key !== key) })),
      clearType: (type) => set((s) => ({ entries: s.entries.filter((e) => e.type !== type) })),
    }),
    {
      name: 'recruitai-recycle-store',
      version: 1,
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        const cutoff = Date.now() - RETAIN_MS;
        state.entries = state.entries.filter((e) => new Date(e.deletedAt).getTime() >= cutoff);
      },
    },
  ),
);
