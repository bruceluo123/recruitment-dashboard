import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { generateId } from '@/lib/utils';

// 今日复推池：两个人各自一列，每列是当天要复推的简历清单。
// 简历以 base64 data URL 形式存入 localStorage，刷新不丢；每份带「已反馈/未反馈」状态。

export type RepushColumnId = 'a' | 'b';
export type FeedbackStatus = 'done' | 'pending';

export interface RepushItem {
  id: string;
  column: RepushColumnId;
  fileName: string;
  fileType: string;       // MIME 类型，下载时复用
  dataUrl: string;        // base64 data URL，持久化保存文件本体
  feedback: FeedbackStatus;
  organization?: string;  // 该简历推荐到的编制组织（来源于 JD 库的编制组织列表）
  uploadedAt: string;
}

interface RepushStore {
  items: RepushItem[];
  columnNames: Record<RepushColumnId, string>;
  addItem: (column: RepushColumnId, file: { fileName: string; fileType: string; dataUrl: string }) => void;
  removeItem: (id: string) => void;
  setFeedback: (id: string, feedback: FeedbackStatus) => void;
  setOrganization: (id: string, organization: string) => void;
  renameColumn: (column: RepushColumnId, name: string) => void;
}

const DEFAULT_NAMES: Record<RepushColumnId, string> = { a: '推荐池 A', b: '推荐池 B' };

export const useRepushStore = create<RepushStore>()(
  persist(
    (set) => ({
      items: [],
      columnNames: DEFAULT_NAMES,
      addItem: (column, file) => set((s) => ({
        items: [
          ...s.items,
          {
            id: generateId(),
            column,
            fileName: file.fileName,
            fileType: file.fileType,
            dataUrl: file.dataUrl,
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
      renameColumn: (column, name) => set((s) => ({
        columnNames: { ...s.columnNames, [column]: name.trim() || DEFAULT_NAMES[column] },
      })),
    }),
    { name: 'recruitai-repush-store' },
  ),
);
