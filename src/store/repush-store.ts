import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { generateId } from '@/lib/utils';

// 今日复推池：两个人各自一列，每列是当天要复推的简历清单。
// 只记录文件名与编制/部门/反馈状态（不存文件本体，避免 localStorage 配额溢出导致丢失）。

export type RepushColumnId = 'a' | 'b';
export type FeedbackStatus = 'done' | 'pending';

export interface RepushItem {
  id: string;
  column: RepushColumnId;
  fileName: string;
  dataUrl?: string;       // 旧版 base64，仅兼容历史数据（新增项不再写入）
  feedback: FeedbackStatus;
  organization?: string;  // 该简历推荐到的编制组织/中心（来源于 JD 库的编制组织列表）
  department?: string;    // 该简历推荐到的部门（来源于 JD 库的部门列表）
  uploadedAt: string;
}

interface RepushStore {
  items: RepushItem[];
  columnNames: Record<RepushColumnId, string>;
  addItem: (column: RepushColumnId, fileName: string) => void;
  removeItem: (id: string) => void;
  setFeedback: (id: string, feedback: FeedbackStatus) => void;
  setOrganization: (id: string, organization: string) => void;
  setDepartment: (id: string, department: string) => void;
  renameColumn: (column: RepushColumnId, name: string) => void;
}

const DEFAULT_NAMES: Record<RepushColumnId, string> = { a: '推荐池 A', b: '推荐池 B' };

export const useRepushStore = create<RepushStore>()(
  persist(
    (set) => ({
      items: [],
      columnNames: DEFAULT_NAMES,
      addItem: (column, fileName) => set((s) => ({
        items: [
          ...s.items,
          {
            id: generateId(),
            column,
            fileName,
            feedback: 'pending' as const,
            uploadedAt: new Date().toISOString(),
          },
        ],
      })),
      removeItem: (id) => set((s) => ({ items: s.items.filter((it) => it.id !== id) })),
      setFeedback: (id, feedback) => set((s) => ({
        items: s.items.map((it) => (it.id === id ? { ...it, feedback } : it)),
      })),
      setOrganization: (id, organization) => set((s) => ({
        items: s.items.map((it) => (it.id === id ? { ...it, organization: organization || undefined } : it)),
      })),
      setDepartment: (id, department) => set((s) => ({
        items: s.items.map((it) => (it.id === id ? { ...it, department: department || undefined } : it)),
      })),
      renameColumn: (column, name) => set((s) => ({
        columnNames: { ...s.columnNames, [column]: name.trim() || DEFAULT_NAMES[column] },
      })),
    }),
    { name: 'recruitai-repush-store' },
  ),
);
