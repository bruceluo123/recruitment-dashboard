import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { generateId } from '@/lib/utils';
import { isTombstoned, rememberDeliveryReceipt } from '@/lib/sync';
import type { SyncRecord } from '@/lib/record-changes';

// 今日复推池：两个人各自一列，每列是当天要复推的简历清单。
// 只记录文件名与编制/部门/反馈状态（不存文件本体，避免 localStorage 配额溢出导致丢失）。

export type RepushColumnId = 'a' | 'b';
export type FeedbackStatus = 'done' | 'pending';
export type InterviewStatus = 'none' | 'scheduled';
export type InterviewRound = '一面' | '二面' | '三面';
export type RecommendationDeliveryStatus = 'manual' | 'queued' | 'sending' | 'sent' | 'partial_failed' | 'failed';

export interface RepushItem {
  id: string;
  applicationId?: string;      // 本次候选人+岗位投递身份；旧记录默认回退到 id
  column: RepushColumnId;       // 推荐人（a/b 两列）
  fileName: string;            // 显示名（文本录入时为「姓名-岗位」，文件拖入时为文件名）
  candidateCode?: string;       // 候选人编码（复推时沿用）
  candidateIdentityId?: string; // 跨推荐、TG 回流与人才库保持稳定的候选人身份
  candidateName?: string;      // 推荐人姓名（简历提取）
  jdId?: string;               // 岗位稳定 ID；展示字段相同的岗位仍需分别记账
  jdTitle?: string;            // 推荐岗位（简历提取）
  contact?: string;            // 候选人联系方式（约面用）
  contactPerson?: string;      // 简历对接人/推荐人（非候选人本人）
  rawText?: string;            // 录入时粘贴的简历原文（截断保存，便于回看）
  dataUrl?: string;            // 旧版 base64，仅兼容历史数据（新增项不再写入）
  highlights?: string;         // AI 从简历中提取的候选人亮点摘要（仅内部可见）
  resumeUrl?: string;          // 简历文件 Blob 链接（上传文件时写入，全链路跟随候选人）
  resumeFileName?: string;     // 简历原始文件名
  talentId?: string;           // 导入人才库后关联的人才 id（跨模块主键）
  feedback: FeedbackStatus;
  interviewStatus?: InterviewStatus;  // 是否已约面
  interviewRound?: InterviewRound;    // 约面轮次（一面/二面/三面）
  candidateId?: string;        // 约面后关联的面试日历候选人 id
  interviewAt?: string;        // 约面时间（ISO，约面后写入）
  source?: 'intake' | 'repush'; // 推荐来源；日报按实际送达时间统计两类记录
  repushSourceId?: string;     // 复推时关联原推荐记录
  deliveryId?: string;         // 发送队列任务 ID
  deliveryIndex?: number;      // 该岗位在发送任务中的序号
  deliveryStatus?: RecommendationDeliveryStatus;
  deliveryUpdatedAt?: string;  // 发送状态独立版本，不能覆盖人工业务编辑时间
  telegramMessageId?: string;  // 该岗位实际送达后的 TG 消息 ID
  deliveredAt?: string;
  offerAppliedAt?: string;     // 点击并确认 Offer 的时间
  organization?: string;       // 该简历推荐到的编制组织/中心（来源于 JD 库的编制组织列表）
  department?: string;         // 该简历推荐到的部门（来源于 JD 库的部门列表）
  uploadedAt: string;          // 推荐时间（按天分组用）
  updatedAt?: string;          // 最后修改时间（跨端同步时防止旧状态覆盖新状态）
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
  candidateCode?: string;
  candidateIdentityId?: string;
  candidateName: string;
  jdId?: string;
  jdTitle?: string;
  contact?: string;
  contactPerson?: string;
  rawText?: string;
  organization?: string;
  department?: string;
  highlights?: string;   // AI 从简历中提取的候选人亮点摘要（仅内部可见）
  resumeUrl?: string;    // 简历文件 Blob 链接（上传文件时带入）
  resumeFileName?: string;
  source?: 'intake' | 'repush';
  repushSourceId?: string;
  applicationId?: string;
  deliveryId?: string;
  deliveryIndex?: number;
  deliveryStatus?: RecommendationDeliveryStatus;
  deliveryUpdatedAt?: string;
  telegramMessageId?: string;
  deliveredAt?: string;
  uploadedAt?: string;
  updatedAt?: string;
}

interface RepushStore {
  items: RepushItem[];
  columnNames: Record<RepushColumnId, string>;
  unfeedbackSnapshots: UnfeedbackSnapshot[];
  addItem: (column: RepushColumnId, fileName: string) => void;
  addRecommendation: (rec: NewRecommendation) => void;
  upsertDeliveryRecommendation: (record: RepushItem) => void;
  updateItem: (id: string, partial: Partial<RepushItem>) => void;
  removeItem: (id: string) => void;
  setFeedback: (id: string, feedback: FeedbackStatus) => void;
  setOrganization: (id: string, organization: string) => void;
  setDepartment: (id: string, department: string) => void;
  renameColumn: (column: RepushColumnId, name: string) => void;
  recordUnfeedbackSnapshot: (s: { weekKey: string; column: RepushColumnId; text: string }) => void;
}

const DEFAULT_NAMES: Record<RepushColumnId, string> = { a: '麦满分', b: '啵啵' };
/** 云端保留完整推荐记录；浏览器缓存不再重复保存旧版 base64 简历文件。 */
function compactLocalItem(item: RepushItem): RepushItem {
  const { dataUrl, ...rest } = item;
  void dataUrl;
  return rest;
}

export const useRepushStore = create<RepushStore>()(
  persist(
    (set) => ({
      items: [],
      columnNames: DEFAULT_NAMES,
      unfeedbackSnapshots: [],
      addItem: (column, fileName) => set((s) => {
        const now = new Date().toISOString();
        return {
          items: [
            ...s.items,
            {
            id: generateId(),
            column,
            fileName,
            feedback: 'pending' as const,
            interviewStatus: 'none' as const,
              uploadedAt: now,
              updatedAt: now,
            },
          ],
        };
      }),
      addRecommendation: (rec) => set((s) => {
        const applicationIndex = rec.applicationId
          ? s.items.findIndex((item) => item.applicationId === rec.applicationId || item.id === rec.applicationId)
          : -1;
        const deliveryMatches = applicationIndex < 0 && !rec.applicationId && rec.deliveryId
          ? s.items.map((item, index) => ({ item, index })).filter(({ item }) => (
            item.deliveryId === rec.deliveryId
            && (rec.jdId ? item.jdId === rec.jdId : (
              item.jdTitle === rec.jdTitle
              && item.organization === rec.organization
              && item.department === rec.department
            ))
          ))
          : [];
        const existingDeliveryIndex = applicationIndex >= 0
          ? applicationIndex
          : deliveryMatches.length === 1 ? deliveryMatches[0].index : -1;
        if (existingDeliveryIndex >= 0) {
          const existing = s.items[existingDeliveryIndex];
          const deliveryStatus = rec.deliveryStatus || existing.deliveryStatus;
          const deliveryUpdatedAt = rec.deliveryUpdatedAt || existing.deliveryUpdatedAt;
          const telegramMessageId = rec.telegramMessageId || existing.telegramMessageId;
          const deliveredAt = rec.deliveredAt || existing.deliveredAt;
          const candidateIdentityId = rec.candidateIdentityId || existing.candidateIdentityId;
          const applicationId = rec.applicationId || existing.applicationId;
          const jdId = rec.jdId || existing.jdId;
          const deliveryIndex = rec.deliveryIndex ?? existing.deliveryIndex;
          const updatedAt = rec.updatedAt || existing.updatedAt;
          if (deliveryStatus === existing.deliveryStatus
            && telegramMessageId === existing.telegramMessageId
            && deliveredAt === existing.deliveredAt
            && candidateIdentityId === existing.candidateIdentityId
            && applicationId === existing.applicationId
            && jdId === existing.jdId
            && deliveryIndex === existing.deliveryIndex
            && deliveryUpdatedAt === existing.deliveryUpdatedAt
            && updatedAt === existing.updatedAt) return {};
          const items = [...s.items];
          items[existingDeliveryIndex] = {
            ...existing,
            deliveryStatus,
            telegramMessageId,
            deliveredAt,
            candidateIdentityId,
            applicationId,
            jdId,
            deliveryIndex,
            deliveryUpdatedAt,
            updatedAt: rec.updatedAt || new Date().toISOString(),
          };
          return { items };
        }
        const displayName = rec.jdTitle ? `${rec.candidateName}-${rec.jdTitle}` : rec.candidateName;
        const now = rec.uploadedAt || new Date().toISOString();
        const id = rec.applicationId || generateId();
        return {
          items: [
            ...s.items,
            {
              id,
              applicationId: rec.applicationId || id,
              column: rec.column,
              fileName: displayName,
              candidateCode: rec.candidateCode || undefined,
              candidateIdentityId: rec.candidateIdentityId || undefined,
              candidateName: rec.candidateName,
              jdId: rec.jdId || undefined,
              jdTitle: rec.jdTitle || undefined,
              contact: rec.contact || undefined,
              contactPerson: rec.contactPerson || undefined,
              rawText: rec.rawText ? rec.rawText.slice(0, 2000) : undefined,
              highlights: rec.highlights ? rec.highlights.slice(0, 1500) : undefined,
              resumeUrl: rec.resumeUrl || undefined,
              resumeFileName: rec.resumeFileName || undefined,
              source: rec.source || 'intake',
              repushSourceId: rec.repushSourceId || undefined,
              deliveryId: rec.deliveryId || undefined,
              deliveryIndex: rec.deliveryIndex,
              deliveryStatus: rec.deliveryStatus || undefined,
              deliveryUpdatedAt: rec.deliveryUpdatedAt || undefined,
              telegramMessageId: rec.telegramMessageId || undefined,
              deliveredAt: rec.deliveredAt || undefined,
              feedback: 'pending' as const,
              interviewStatus: 'none' as const,
              organization: rec.organization || undefined,
              department: rec.department || undefined,
              uploadedAt: now,
              updatedAt: rec.updatedAt || now,
            },
          ],
        };
      }),
      upsertDeliveryRecommendation: (record) => set((s) => {
        if (!record?.id || (record.column !== 'a' && record.column !== 'b')) return {};
        if (isTombstoned('repush', record.id) || record.applicationId && isTombstoned('repush', record.applicationId)) return {};
        rememberDeliveryReceipt(record as unknown as SyncRecord);
        const index = s.items.findIndex((item) => (
          item.id === record.id
          || (record.applicationId && item.applicationId === record.applicationId)
        ));
        if (index < 0) return { items: [...s.items, record] };
        const current = s.items[index];
        const incomingDeliveryAt = String(record.deliveryUpdatedAt || record.updatedAt || record.uploadedAt);
        const currentDeliveryAt = String(current.deliveryUpdatedAt || '');
        const acceptsDelivery = !(current.deliveryStatus === 'sent' && record.deliveryStatus !== 'sent')
          && (!currentDeliveryAt || incomingDeliveryAt > currentDeliveryAt
            || incomingDeliveryAt === currentDeliveryAt && record.deliveryStatus === 'sent');
        const merged = {
          ...current,
          applicationId: record.applicationId || current.applicationId,
          jdId: record.jdId || current.jdId,
          deliveryId: record.deliveryId || current.deliveryId,
          deliveryIndex: record.deliveryIndex ?? current.deliveryIndex,
          ...(acceptsDelivery ? {
            deliveryStatus: record.deliveryStatus,
            deliveryUpdatedAt: incomingDeliveryAt || current.deliveryUpdatedAt,
            telegramMessageId: record.telegramMessageId,
            deliveredAt: record.deliveredAt,
          } : {}),
        };
        if (JSON.stringify(current) === JSON.stringify(merged)) return {};
        const items = [...s.items];
        items[index] = merged;
        return { items };
      }),
      updateItem: (id, partial) => set((s) => ({
        items: s.items.map((it) => (it.id === id ? { ...it, ...partial, updatedAt: new Date().toISOString() } : it)),
      })),
      removeItem: (id) => set((s) => {
        const item = s.items.find((it) => it.id === id);
        if (!item || item.deliveryStatus === 'queued' || item.deliveryStatus === 'sending') return {};
        return { items: s.items.filter((it) => it.id !== id) };
      }),
      setFeedback: (id, feedback) => set((s) => ({
        items: s.items.map((it) => (it.id === id ? { ...it, feedback, updatedAt: new Date().toISOString() } : it)),
      })),
      setOrganization: (id, organization) => set((s) => ({
        items: s.items.map((it) => (it.id === id ? { ...it, organization: organization || undefined, updatedAt: new Date().toISOString() } : it)),
      })),
      setDepartment: (id, department) => set((s) => ({
        items: s.items.map((it) => (it.id === id ? { ...it, department: department || undefined, updatedAt: new Date().toISOString() } : it)),
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
      version: 2,
      partialize: (state) => ({
        items: state.items.map(compactLocalItem),
        columnNames: state.columnNames,
        unfeedbackSnapshots: state.unfeedbackSnapshots,
      }),
      // v2：浏览器本地缓存移除旧版 base64 简历；云端完整数据不变。
      migrate: (persisted) => {
        const s = persisted as Partial<RepushStore> | undefined;
        return {
          ...(s as object),
          items: (s?.items || []).map(compactLocalItem),
          columnNames: DEFAULT_NAMES,
        } as RepushStore;
      },
    },
  ),
);
