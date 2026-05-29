import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Talent, TalentFilter, TalentImportResult } from '@/types/talent';
import type { JDCategory } from '@/types/jd';
import { JD_CATEGORY_LABELS, ALL_CATEGORIES } from '@/types/jd';
import { generateId } from '@/lib/utils';
import { detectCategories } from '@/lib/jd-parse-core';
import { extractMultipleTalents } from '@/lib/talent-extract';

export interface TalentImportProgress {
  current: number; total: number; percent: number;
  status: 'idle' | 'uploading' | 'parsing' | 'done';
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

async function parseResumeText(file: File): Promise<string> {
  try {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/resume/parse', { method: 'POST', body: fd });
    if (!res.ok) return '';
    const data = await res.json();
    return String(data?.text || '');
  } catch { return ''; }
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

        // 1) 上传 + 解析文本（每个文件并行做这两件事）
        const uploaded: ({ url: string; downloadUrl: string; fileName: string } | null)[] = new Array(files.length).fill(null);
        const texts: string[] = new Array(files.length).fill('');

        for (let i = 0; i < files.length; i++) {
          if (get().importCancelled) {
            set({ isImporting: false, importCancelled: false });
            return { success: 0, failed: 0, errors: ['已取消导入'] };
          }
          const file = files[i];
          const [up, txt] = await Promise.all([uploadResume(file), parseResumeText(file)]);
          uploaded[i] = up;
          texts[i] = txt;
          if (!up) { result.errors.push(`${file.name}: 文件上传失败`); }
          const pct = Math.round(((i + 1) / files.length) * 50);
          set({ importProgress: { current: i + 1, total: files.length, percent: pct, status: 'uploading' } });
        }

        // 2) AI 批量识别姓名 + 最近岗位 title
        set({ importProgress: { current: 0, total: files.length, percent: 50, status: 'parsing' } });
        const extracted: ({ name: string; jobTitle: string } | null)[] = new Array(files.length).fill(null);
        const BATCH = 5;
        for (let b = 0; b < files.length; b += BATCH) {
          if (get().importCancelled) {
            set({ isImporting: false, importCancelled: false });
            return { success: 0, failed: 0, errors: ['已取消导入'] };
          }
          const slice = texts.slice(b, b + BATCH);
          const parsed = await extractMultipleTalents(slice);
          parsed.forEach((p, k) => { extracted[b + k] = p; });
          const pct = 50 + Math.round((Math.min(b + BATCH, files.length) / files.length) * 50);
          set({ importProgress: { current: Math.min(b + BATCH, files.length), total: files.length, percent: Math.min(100, pct), status: 'parsing' } });
        }

        // 3) 组装人选记录
        const batch: Talent[] = [];
        for (let i = 0; i < files.length; i++) {
          const up = uploaded[i];
          const ex = extracted[i];
          const name = ex?.name?.trim() || files[i].name.replace(/\.(pdf|docx?|PDF|DOCX?)$/i, '');
          const jobTitle = ex?.jobTitle?.trim() || '';
          batch.push({
            id: generateId(),
            name,
            jobTitle,
            categories: jobTitle ? detectCategories(jobTitle) : ['operations'],
            resumeUrl: up?.downloadUrl || undefined,
            resumeFileName: up?.fileName || files[i].name,
            tg: '',
            notes: '',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
          result.success++;
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
