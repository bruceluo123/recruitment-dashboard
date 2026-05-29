import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Talent, TalentFilter, TalentImportResult } from '@/types/talent';
import type { JDCategory } from '@/types/jd';
import { JD_CATEGORY_LABELS, ALL_CATEGORIES } from '@/types/jd';
import { generateId } from '@/lib/utils';
import { detectCategories } from '@/lib/jd-parse-core';

export interface TalentImportProgress {
  current: number; total: number; percent: number;
  status: 'idle' | 'uploading' | 'parsing' | 'done';
}

/** 从文件名解析姓名与岗位，格式约定为「姓名-岗位.ext」，分隔符支持 - _ －。 */
function parseFileName(fileName: string): { name: string; jobTitle: string } {
  const base = fileName.replace(/\.(pdf|docx?|PDF|DOCX?)$/i, '').trim();
  const sep = base.search(/[-_－]/);
  if (sep === -1) return { name: base, jobTitle: '' };
  return {
    name: base.slice(0, sep).trim(),
    jobTitle: base.slice(sep + 1).trim(),
  };
}

interface TalentStore {
  talents: Talent[];
  filter: TalentFilter;
  selectedTalentId: string | null;
  isImporting: boolean;
  importCancelled: boolean;
  importProgress: TalentImportProgress;
  lastDeletedTalent: Talent | null;
  cancelImport: () => void;
  selectTalent: (id: string | null) => void;
  setFilter: (partial: Partial<TalentFilter>) => void;
  resetFilter: () => void;
  addTalent: (talent: Talent) => void;
  updateTalent: (id: string, partial: Partial<Talent>) => void;
  deleteTalent: (id: string) => void;
  deleteTalentBatch: (ids: string[]) => void;
  undoDeleteTalent: () => void;
  clearAllTalents: () => void;
  importFromFiles: (files: File[]) => Promise<TalentImportResult>;
}

async function uploadResume(file: File): Promise<{ url: string; downloadUrl: string; fileName: string } | null> {
  try {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/talent/upload', { method: 'POST', body: fd });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.url) return null;
    return { url: data.url, downloadUrl: data.downloadUrl || data.url, fileName: data.fileName || file.name };
  } catch { return null; }
}

export const useTalentStore = create<TalentStore>()(
  persist(
    (set, get) => ({
      talents: [],
      filter: { search: '', category: 'all' },
      selectedTalentId: null,
      isImporting: false,
      importCancelled: false,
      importProgress: { current: 0, total: 0, percent: 0, status: 'idle' },
      lastDeletedTalent: null,
      cancelImport: () => set({ importCancelled: true }),

      selectTalent: (id) => set({ selectedTalentId: id }),
      setFilter: (partial) => set((s) => ({ filter: { ...s.filter, ...partial } })),
      resetFilter: () => set({ filter: { search: '', category: 'all' } }),

      addTalent: (talent) => set((s) => ({ talents: [talent, ...s.talents] })),
      updateTalent: (id, partial) => set((s) => ({
        talents: s.talents.map((t) => t.id === id ? { ...t, ...partial, updatedAt: new Date().toISOString() } : t),
      })),
      deleteTalent: (id) => set((s) => {
        const target = s.talents.find((t) => t.id === id);
        return { talents: s.talents.filter((t) => t.id !== id), lastDeletedTalent: target || null };
      }),
      deleteTalentBatch: (ids) => set((s) => {
        const idSet = new Set(ids);
        return { talents: s.talents.filter((t) => !idSet.has(t.id)), lastDeletedTalent: null };
      }),
      undoDeleteTalent: () => set((s) => {
        if (!s.lastDeletedTalent) return {};
        return { talents: [s.lastDeletedTalent, ...s.talents], lastDeletedTalent: null };
      }),
      clearAllTalents: () => set({ talents: [], lastDeletedTalent: null }),

      importFromFiles: async (files: File[]) => {
        const result: TalentImportResult = { success: 0, failed: 0, errors: [] };
        if (!files.length) return result;

        set({ isImporting: true, importCancelled: false, importProgress: { current: 0, total: files.length, percent: 0, status: 'uploading' } });

        // 上传文件并从文件名解析「姓名-岗位」，无需 AI 解析正文
        const batch: Talent[] = [];
        for (let i = 0; i < files.length; i++) {
          if (get().importCancelled) {
            set({ isImporting: false, importCancelled: false });
            return { success: 0, failed: 0, errors: ['已取消导入'] };
          }
          const file = files[i];
          const up = await uploadResume(file);
          if (!up) { result.errors.push(`${file.name}: 文件上传失败`); }

          const { name, jobTitle } = parseFileName(file.name);
          batch.push({
            id: generateId(),
            name: name || file.name.replace(/\.(pdf|docx?|PDF|DOCX?)$/i, ''),
            jobTitle,
            categories: jobTitle ? detectCategories(jobTitle) : ['operations'],
            resumeUrl: up?.downloadUrl || undefined,
            resumeFileName: up?.fileName || file.name,
            tg: '',
            notes: '',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
          result.success++;
          const pct = Math.round(((i + 1) / files.length) * 100);
          set({ importProgress: { current: i + 1, total: files.length, percent: pct, status: 'uploading' } });
        }

        set((s) => ({
          talents: [...batch, ...s.talents],
          isImporting: false,
          importProgress: { current: files.length, total: files.length, percent: 100, status: 'done' },
        }));
        return result;
      },
    }),
    {
      name: 'recruitai-talent-store',
      version: 1,
      partialize: (state) => {
        const { isImporting, importCancelled, importProgress, cancelImport, ...rest } = state;
        void isImporting; void importCancelled; void importProgress; void cancelImport;
        return rest;
      },
    },
  ),
);

// ─── Selectors ───

export function useFilteredTalents(): Talent[] {
  const { talents, filter } = useTalentStore();
  return talents.filter((t) => {
    if (filter.category !== 'all' && !(t.categories || []).includes(filter.category)) return false;
    if (filter.search) {
      const q = filter.search.toLowerCase();
      const haystack = [t.name, t.jobTitle, t.tg, t.notes].filter(Boolean).join(' ').toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

export function useTalentCategoryCounts(): { id: JDCategory | 'all'; label: string; count: number }[] {
  const { talents } = useTalentStore();
  const entries: { id: JDCategory | 'all'; label: string; count: number }[] = [{ id: 'all', label: '全部', count: talents.length }];
  for (const cat of ALL_CATEGORIES) {
    const count = talents.filter((t) => (t.categories || []).includes(cat)).length;
    if (count > 0) entries.push({ id: cat, label: JD_CATEGORY_LABELS[cat], count });
  }
  return entries;
}
