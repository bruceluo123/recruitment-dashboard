import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { generateId } from '@/lib/utils';

// 今日复推池：两个人各自一列，每列是当天要复推的简历清单。
// 只记录文件名与编制/部门/反馈状态（不存文件本体，避免 localStorage 配额溢出导致丢失）。

export type RepushColumnId = 'a' | 'b';
export type FeedbackStatus = 'done' | 'pending';
export type InterviewStatus = 'none' | 'scheduled';
export type InterviewRound = '一面' | '二面' | '三面';

export interface RepushItem {
  id: string;
  column: RepushColumnId;       // 推荐人（a/b 两列）
  fileName: string;            // 显示名（文本录入时为「姓名-岗位」，文件拖入时为文件名）
  candidateName?: string;      // 推荐人姓名（简历提取）
  jdTitle?: string;            // 推荐岗位（简历提取）
  contact?: string;            // 候选人联系方式（约面用）
  contactPerson?: string;      // 简历对接人/推荐人（非候选人本人）
  rawText?: string;            // 录入时粘贴的简历原文（截断保存，便于回看）
  dataUrl?: string;            // 旧版 base64，仅兼容历史数据（新增项不再写入）
  feedback: FeedbackStatus;
  interviewStatus?: InterviewStatus;  // 是否已约面
  interviewRound?: InterviewRound;    // 约面轮次（一面/二面/三面）
  candidateId?: string;        // 约面后关联的面试日历候选人 id
  interviewAt?: string;        // 约面时间（ISO，约面后写入）
  organization?: string;       // 该简历推荐到的编制组织/中心（来源于 JD 库的编制组织列表）
  department?: string;         // 该简历推荐到的部门（来源于 JD 库的部门列表）
  uploadedAt: string;          // 推荐时间（按天分组用）
}

/** 未反馈清单快照：每生成一次自动记录，供「上周未反馈」回看复制 */
export interface UnfeedbackSnapshot {
  id: string;
  weekKey: string;             // 该周周一的日期键 YYYY-MM-DD
  column: RepushColumnId;      // 归属推荐人
  text: string;               // 生成时的清单文本
  generatedAt: string;        // 生成时间 ISO
}

/** 简历入口录入一条推荐记录所需字段 */
export interface NewRecommendation {
  column: RepushColumnId;
  candidateName: string;
  jdTitle?: string;
  contact?: string;
  contactPerson?: string;
  rawText?: string;
  organization?: string;
  department?: string;
}

interface RepushStore {
  items: RepushItem[];
  columnNames: Record<RepushColumnId, string>;
  unfeedbackSnapshots: UnfeedbackSnapshot[];
  addItem: (column: RepushColumnId, fileName: string) => void;
  addRecommendation: (rec: NewRecommendation) => void;
  updateItem: (id: string, partial: Partial<RepushItem>) => void;
  removeItem: (id: string) => void;
  setFeedback: (id: string, feedback: FeedbackStatus) => void;
  setOrganization: (id: string, organization: string) => void;
  setDepartment: (id: string, department: string) => void;
  renameColumn: (column: RepushColumnId, name: string) => void;
  recordUnfeedbackSnapshot: (s: { weekKey: string; column: RepushColumnId; text: string }) => void;
}

const DEFAULT_NAMES: Record<RepushColumnId, string> = { a: '麦满分', b: '啵啵' };

export const useRepushStore = create<RepushStore>()(
  persist(
    (set) => ({
      items: [],
      columnNames: DEFAULT_NAMES,
      unfeedbackSnapshots: [],
      addItem: (column, fileName) => set((s) => ({
        items: [
          ...s.items,
          {
            id: generateId(),
            column,
            fileName,
            feedback: 'pending' as const,
            interviewStatus: 'none' as const,
            uploadedAt: new Date().toISOString(),
          },
        ],
      })),
      addRecommendation: (rec) => set((s) => {
        const displayName = rec.jdTitle ? `${rec.candidateName}-${rec.jdTitle}` : rec.candidateName;
        return {
          items: [
            ...s.items,
            {
              id: generateId(),
              column: rec.column,
              fileName: displayName,
              candidateName: rec.candidateName,
              jdTitle: rec.jdTitle || undefined,
              contact: rec.contact || undefined,
              contactPerson: rec.contactPerson || undefined,
              rawText: rec.rawText ? rec.rawText.slice(0, 2000) : undefined,
              feedback: 'pending' as const,
              interviewStatus: 'none' as const,
              organization: rec.organization || undefined,
              department: rec.department || undefined,
              uploadedAt: new Date().toISOString(),
            },
          ],
        };
      }),
      updateItem: (id, partial) => set((s) => ({
        items: s.items.map((it) => (it.id === id ? { ...it, ...partial } : it)),
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
      // 记录一次未反馈清单快照：同一周同一推荐人只保留最新一份
      recordUnfeedbackSnapshot: ({ weekKey, column, text }) => set((s) => {
        const rest = s.unfeedbackSnapshots.filter((snap) => !(snap.weekKey === weekKey && snap.column === column));
        return {
          unfeedbackSnapshots: [
            ...rest,
            { id: generateId(), weekKey, column, text, generatedAt: new Date().toISOString() },
          ],
        };
      }),
    }),
    {
      name: 'recruitai-repush-store',
      version: 1,
      // v1：把推荐人列名统一为 麦满分 / 啵啵（覆盖历史自定义名）
      migrate: (persisted) => {
        const s = persisted as Partial<RepushStore> | undefined;
        return { ...(s as object), columnNames: DEFAULT_NAMES } as RepushStore;
      },
    },
  ),
);
