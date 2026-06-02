import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Talent, TalentFilter, TalentImportResult } from '@/types/talent';
import type { JDCategory } from '@/types/jd';
import { JD_CATEGORY_LABELS, ALL_CATEGORIES } from '@/types/jd';
import { generateId } from '@/lib/utils';
import { classifyTitleCategories } from '@/lib/talent-extract';

export interface TalentImportProgress {
  current: number; total: number; percent: number;
  status: 'idle' | 'uploading' | 'parsing' | 'done';
}

export interface TalentScanProgress {
  current: number; total: number; succeeded: number; failed: number;
  status: 'idle' | 'scanning' | 'done';
}

export interface TalentScanResult { scanned: number; failed: number; errors: string[]; }

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
  isScanning: boolean;
  scanCancelled: boolean;
  scanProgress: TalentScanProgress;
  lastDeletedTalent: Talent | null;
  cancelImport: () => void;
  cancelScan: () => void;
  scanResumes: () => Promise<TalentScanResult>;
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
      isScanning: false,
      scanCancelled: false,
      scanProgress: { current: 0, total: 0, succeeded: 0, failed: 0, status: 'idle' },
      lastDeletedTalent: null,
      cancelImport: () => set({ importCancelled: true }),
      cancelScan: () => set({ scanCancelled: true }),

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

      // 批量扫描未识别的简历：拉取 Blob → 提取文字 → 存入 KV，并在本地记录 hasResumeText/resumeChars。
      // 跳过无简历链接或已扫描过的人选。并发 3，可中途取消。
      scanResumes: async () => {
        const result: TalentScanResult = { scanned: 0, failed: 0, errors: [] };
        const pending = get().talents.filter((t) => t.resumeUrl && !t.hasResumeText);
        if (!pending.length) {
          set({ scanProgress: { current: 0, total: 0, succeeded: 0, failed: 0, status: 'done' } });
          return result;
        }

        set({ isScanning: true, scanCancelled: false, scanProgress: { current: 0, total: pending.length, succeeded: 0, failed: 0, status: 'scanning' } });

        const CONCURRENCY = 3;
        let cursor = 0;
        let done = 0;

        const worker = async () => {
          while (true) {
            if (get().scanCancelled) return;
            const idx = cursor++;
            if (idx >= pending.length) return;
            const t = pending[idx];
            try {
              const res = await fetch('/api/talent/scan', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: t.id, url: t.resumeUrl, fileName: t.resumeFileName }),
              });
              const data = await res.json();
              if (res.ok && typeof data.chars === 'number') {
                get().updateTalent(t.id, { hasResumeText: true, resumeChars: data.chars });
                result.scanned++;
              } else {
                result.failed++;
                result.errors.push(`${t.name}: ${data.error || `HTTP ${res.status}`}`);
              }
            } catch (err) {
              result.failed++;
              result.errors.push(`${t.name}: ${(err as Error).message}`);
            }
            done++;
            set({ scanProgress: { current: done, total: pending.length, succeeded: result.scanned, failed: result.failed, status: 'scanning' } });
          }
        };

        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, () => worker()));

        set({ isScanning: false, scanCancelled: false, scanProgress: { current: done, total: pending.length, succeeded: result.scanned, failed: result.failed, status: 'done' } });
        return result;
      },

      importFromFiles: async (files: File[]) => {
        const result: TalentImportResult = { success: 0, failed: 0, errors: [] };
        if (!files.length) return result;

        set({ isImporting: true, importCancelled: false, importProgress: { current: 0, total: files.length, percent: 0, status: 'uploading' } });

        // 1) 上传文件 + 从文件名解析「姓名-岗位」（0-60%）
        const parsed: { name: string; jobTitle: string; up: Awaited<ReturnType<typeof uploadResume>>; fileName: string }[] = [];
        for (let i = 0; i < files.length; i++) {
          if (get().importCancelled) {
            set({ isImporting: false, importCancelled: false });
            return { success: 0, failed: 0, errors: ['已取消导入'] };
          }
          const file = files[i];
          const up = await uploadResume(file);
          if (!up) { result.errors.push(`${file.name}: 文件上传失败`); }
          const { name, jobTitle } = parseFileName(file.name);
          parsed.push({ name: name || file.name.replace(/\.(pdf|docx?|PDF|DOCX?)$/i, ''), jobTitle, up, fileName: file.name });
          const pct = Math.round(((i + 1) / files.length) * 60);
          set({ importProgress: { current: i + 1, total: files.length, percent: pct, status: 'uploading' } });
        }

        // 2) 用 AI 按岗位名称批量分类（参照 JD 库分类体系，60-100%）
        set({ importProgress: { current: 0, total: files.length, percent: 60, status: 'parsing' } });
        const titles = parsed.map((p) => p.jobTitle);
        const categories: JDCategory[][] = new Array(parsed.length);
        const BATCH = 30;
        for (let b = 0; b < titles.length; b += BATCH) {
          if (get().importCancelled) {
            set({ isImporting: false, importCancelled: false });
            return { success: 0, failed: 0, errors: ['已取消导入'] };
          }
          const slice = titles.slice(b, b + BATCH);
          const cats = await classifyTitleCategories(slice);
          cats.forEach((c, k) => { categories[b + k] = c.length ? c : ['operations']; });
          const done = Math.min(b + BATCH, titles.length);
          const pct = 60 + Math.round((done / titles.length) * 40);
          set({ importProgress: { current: done, total: titles.length, percent: Math.min(100, pct), status: 'parsing' } });
        }

        // 3) 组装人选记录
        const batch: Talent[] = parsed.map((p, i) => ({
          id: generateId(),
          name: p.name,
          jobTitle: p.jobTitle,
          categories: categories[i]?.length ? categories[i] : ['operations'],
          resumeUrl: p.up?.downloadUrl || undefined,
          resumeFileName: p.up?.fileName || p.fileName,
          tg: '',
          notes: '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }));
        result.success = batch.length;

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
        const { isImporting, importCancelled, importProgress, cancelImport,
          isScanning, scanCancelled, scanProgress, cancelScan, scanResumes, ...rest } = state;
        void isImporting; void importCancelled; void importProgress; void cancelImport;
        void isScanning; void scanCancelled; void scanProgress; void cancelScan; void scanResumes;
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
