import { useMemo } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Talent, TalentFilter, TalentImportResult } from '@/types/talent';
import type { JDCategory } from '@/types/jd';
import { JD_CATEGORY_LABELS, ALL_CATEGORIES } from '@/types/jd';
import { generateId } from '@/lib/utils';
import { currentOperatorName } from '@/lib/operator';
import { useRecycleStore } from '@/store/recycle-store';
import { classifyTitleCategories } from '@/lib/talent-extract';
import { detectCategories } from '@/lib/jd-parse-core';
import { extractTalentFieldsBatch } from '@/lib/talent-field-extract';

export interface TalentImportProgress {
  current: number; total: number; percent: number;
  status: 'idle' | 'uploading' | 'parsing' | 'done';
}

export interface TalentScanProgress {
  current: number; total: number; succeeded: number; failed: number;
  status: 'idle' | 'scanning' | 'done';
}

export interface TalentScanResult { scanned: number; failed: number; errors: string[]; }

/** 从文件名解析姓名与岗位，格式约定为「姓名+岗位.ext」，分隔符支持 + - _ －。 */
function parseFileName(fileName: string): { name: string; jobTitle: string } {
  const base = fileName.replace(/\.(pdf|docx?|PDF|DOCX?)$/i, '').trim();
  const sep = base.search(/[+\-_－]/);
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
  archiveAll: () => void;
  setArchived: (id: string, archived: boolean) => void;
  importFromFiles: (files: File[]) => Promise<TalentImportResult>;
}

// 中断器：点击「停止/取消」时 abort 在途请求，让卡住的 fetch 立即返回。
let scanAbort: AbortController | null = null;
let importAbort: AbortController | null = null;

const UPLOAD_TIMEOUT = 60000; // 单份上传超时兜底（计为失败但不影响其他份）

// 上传单份简历：用「全局取消」+「本份超时」两个 controller，超时只影响这一份。
async function uploadResume(
  file: File,
  signal: AbortSignal,
): Promise<{ url: string; downloadUrl: string; fileName: string } | null> {
  const timer = new AbortController();
  const timeout = setTimeout(() => timer.abort(), UPLOAD_TIMEOUT);
  const onStop = () => timer.abort();
  signal.addEventListener('abort', onStop);
  try {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/talent/upload', { method: 'POST', body: fd, signal: timer.signal });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.url) return null;
    return { url: data.url, downloadUrl: data.downloadUrl || data.url, fileName: data.fileName || file.name };
  } catch { return null; }
  finally { clearTimeout(timeout); signal.removeEventListener('abort', onStop); }
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
      cancelImport: () => { importAbort?.abort(); set({ importCancelled: true }); },
      cancelScan: () => { scanAbort?.abort(); set({ scanCancelled: true }); },

      selectTalent: (id) => set({ selectedTalentId: id }),
      setFilter: (partial) => set((s) => ({ filter: { ...s.filter, ...partial } })),
      resetFilter: () => set({ filter: { search: '', category: 'all' } }),

      addTalent: (talent) => set((s) => ({ talents: [talent, ...s.talents] })),
      updateTalent: (id, partial) => set((s) => ({
        talents: s.talents.map((t) => t.id === id ? { ...t, ...partial, updatedAt: new Date().toISOString() } : t),
      })),
      deleteTalent: (id) => {
        const target = get().talents.find((t) => t.id === id) || null;
        if (target) useRecycleStore.getState().push('talent', currentOperatorName(), [{ label: target.name, data: target }]);
        set((s) => ({ talents: s.talents.filter((t) => t.id !== id), lastDeletedTalent: target }));
      },
      deleteTalentBatch: (ids) => {
        const idSet = new Set(ids);
        const removed = get().talents.filter((t) => idSet.has(t.id));
        if (removed.length) useRecycleStore.getState().push('talent', currentOperatorName(), removed.map((t) => ({ label: t.name, data: t })));
        set((s) => ({ talents: s.talents.filter((t) => !idSet.has(t.id)), lastDeletedTalent: null }));
      },
      undoDeleteTalent: () => set((s) => {
        if (!s.lastDeletedTalent) return {};
        return { talents: [s.lastDeletedTalent, ...s.talents], lastDeletedTalent: null };
      }),
      clearAllTalents: () => set({ talents: [], lastDeletedTalent: null }),
      archiveAll: () => set((s) => ({
        talents: s.talents.map((t) => ({ ...t, archived: true, updatedAt: new Date().toISOString() })),
      })),
      setArchived: (id, archived) => set((s) => ({
        talents: s.talents.map((t) => t.id === id ? { ...t, archived, updatedAt: new Date().toISOString() } : t),
      })),

      // 批量扫描未识别的简历：拉取 Blob → 提取文字 → 存入 KV，并在本地记录 hasResumeText/resumeChars。
      // 跳过无简历链接或已扫描过的人选。并发 6（文字型走快路径），可中途取消。
      scanResumes: async () => {
        const result: TalentScanResult = { scanned: 0, failed: 0, errors: [] };
        const pending = get().talents.filter((t) => t.resumeUrl && !t.hasResumeText);
        if (!pending.length) {
          set({ scanProgress: { current: 0, total: 0, succeeded: 0, failed: 0, status: 'done' } });
          return result;
        }

        scanAbort = new AbortController();
        const signal = scanAbort.signal;
        set({ isScanning: true, scanCancelled: false, scanProgress: { current: 0, total: pending.length, succeeded: 0, failed: 0, status: 'scanning' } });

        const CONCURRENCY = 4;
        const REQUEST_TIMEOUT = 45000; // 单份超时兜底（计为失败但不影响其他份）
        let cursor = 0;
        let done = 0;

        // 单份请求：用「全局停止」+「本份超时」两个 controller，超时只影响这一份。
        // 不用 AbortSignal.any/timeout（部分浏览器不支持，曾导致 worker 同步抛错卡死）。
        const scanOne = async (t: Talent): Promise<void> => {
          const timer = new AbortController();
          const timeout = setTimeout(() => timer.abort(), REQUEST_TIMEOUT);
          const onStop = () => timer.abort();
          signal.addEventListener('abort', onStop);
          try {
            const res = await fetch('/api/talent/scan', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: t.id, url: t.resumeUrl, fileName: t.resumeFileName }),
              signal: timer.signal,
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok && typeof data.chars === 'number') {
              get().updateTalent(t.id, { hasResumeText: true, resumeChars: data.chars });
              result.scanned++;
            } else {
              result.failed++;
              result.errors.push(`${t.name}: ${data.error || `HTTP ${res.status}`}`);
            }
          } catch (err) {
            if (signal.aborted) throw err; // 用户停止：上抛由 worker 退出，不计为失败
            // 本份超时或网络错误：计为失败，继续下一份
            result.failed++;
            result.errors.push(`${t.name}: ${(err as Error).name === 'AbortError' ? '处理超时（45秒）' : (err as Error).message}`);
          } finally {
            clearTimeout(timeout);
            signal.removeEventListener('abort', onStop);
          }
        };

        const worker = async () => {
          while (!signal.aborted) {
            const idx = cursor++;
            if (idx >= pending.length) return;
            try {
              await scanOne(pending[idx]);
            } catch {
              return; // 用户停止：退出 worker
            }
            done++;
            set({ scanProgress: { current: done, total: pending.length, succeeded: result.scanned, failed: result.failed, status: 'scanning' } });
          }
        };

        try {
          await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, () => worker()));

          // 文字提取完成后，用 AI 按岗位名称精修分类（参照 JD 库分类体系）。
          // 失败/超时由 classifyTitleCategories 内部回退关键词分类，不影响扫描结果计数。
          if (!signal.aborted) {
            const BATCH = 30;
            for (let b = 0; b < pending.length && !signal.aborted; b += BATCH) {
              const slice = pending.slice(b, b + BATCH);
              const cats = await classifyTitleCategories(slice.map((t) => t.jobTitle), signal);
              cats.forEach((c, k) => {
                if (c.length) get().updateTalent(slice[k].id, { categories: c });
              });
            }
          }

          // 分类完成后，提取结构化字段（company/techDirection/level/school 等）供逆向匹配使用
          if (!signal.aborted) {
            const freshTalents = get().talents;
            const fieldMap = await extractTalentFieldsBatch(
              freshTalents.filter((t) => pending.some((p) => p.id === t.id)),
              signal,
            );
            fieldMap.forEach((fields, talentId) => {
              const update: Partial<import('@/types/talent').Talent> = {};
              if (fields.company) update.company = fields.company;
              if (fields.prevCompanies?.length) update.prevCompanies = fields.prevCompanies;
              if (fields.techDirection) update.techDirection = fields.techDirection;
              if (fields.level) update.level = fields.level;
              if (fields.eduLevel) update.eduLevel = fields.eduLevel;
              if (fields.school) update.school = fields.school;
              if (fields.major) update.major = fields.major;
              if (fields.gradYear) update.gradYear = fields.gradYear;
              if (fields.location) update.location = fields.location;
              if (fields.workIntent) update.workIntent = fields.workIntent;
              if (fields.monthlySalary) update.monthlySalary = fields.monthlySalary;
              if (Object.keys(update).length) get().updateTalent(talentId, update);
            });
          }
        } finally {
          // 无论成功/异常/停止都复位，避免按钮永久卡在「扫描中」
          scanAbort = null;
          set({ isScanning: false, scanCancelled: false, scanProgress: { current: done, total: pending.length, succeeded: result.scanned, failed: result.failed, status: 'done' } });
        }
        return result;
      },

      importFromFiles: async (files: File[]) => {
        const result: TalentImportResult = { success: 0, failed: 0, errors: [] };
        if (!files.length) return result;

        importAbort = new AbortController();
        const signal = importAbort.signal;
        set({ isImporting: true, importCancelled: false, importProgress: { current: 0, total: files.length, percent: 0, status: 'uploading' } });

        // 并发上传文件 + 从文件名解析「姓名-岗位」+ 关键词即时分类（0-100%），可中途取消。
        // AI 精准分类延后到「扫描识别简历」步骤，让上传本身保持快速。
        type Parsed = { name: string; jobTitle: string; up: Awaited<ReturnType<typeof uploadResume>>; fileName: string };
        const parsed: Parsed[] = new Array(files.length);
        const UPLOAD_CONCURRENCY = 4;
        let cursor = 0;
        let uploaded = 0;
        const uploadWorker = async () => {
          while (!signal.aborted) {
            const i = cursor++;
            if (i >= files.length) return;
            const file = files[i];
            const up = await uploadResume(file, signal);
            if (signal.aborted) return;
            if (!up) result.errors.push(`${file.name}: 文件上传失败`);
            const { name, jobTitle } = parseFileName(file.name);
            parsed[i] = { name: name || file.name.replace(/\.(pdf|docx?|PDF|DOCX?)$/i, ''), jobTitle, up, fileName: file.name };
            uploaded++;
            set({ importProgress: { current: uploaded, total: files.length, percent: Math.round((uploaded / files.length) * 100), status: 'uploading' } });
          }
        };
        await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, files.length) }, () => uploadWorker()));
        if (signal.aborted) {
          importAbort = null;
          set({ isImporting: false, importCancelled: false, importProgress: { current: 0, total: 0, percent: 0, status: 'idle' } });
          return { success: 0, failed: 0, errors: ['已取消导入'] };
        }

        // 按姓名匹配已有人选：找到则更新简历链接，找不到则新建
        const now = new Date().toISOString();
        const existingTalents = get().talents;
        const updates: Array<{ id: string; partial: Partial<Talent> }> = [];
        const newBatch: Talent[] = [];

        for (const p of parsed) {
          if (!p.up) { result.failed++; continue; }
          // 按姓名（精确）匹配已有人选，取第一个匹配
          const existing = existingTalents.find(
            (t) => t.name.trim() === p.name.trim() && p.name.trim().length > 0,
          );
          if (existing) {
            updates.push({
              id: existing.id,
              partial: {
                resumeUrl: p.up.downloadUrl,
                resumeFileName: p.up.fileName || p.fileName,
                // 若原来已扫描过文本，重新上传后重置，待下次扫描
                hasResumeText: false,
                resumeChars: undefined,
                updatedAt: now,
              },
            });
          } else {
            const kw = detectCategories(p.jobTitle);
            newBatch.push({
              id: generateId(),
              name: p.name,
              jobTitle: p.jobTitle,
              categories: kw.length ? kw : ['operations'],
              resumeUrl: p.up.downloadUrl || undefined,
              resumeFileName: p.up.fileName || p.fileName,
              tg: '',
              notes: '',
              createdAt: now,
              updatedAt: now,
            });
          }
        }
        result.success = updates.length + newBatch.length;

        importAbort = null;
        set((s) => {
          const merged = s.talents.map((t) => {
            const upd = updates.find((u) => u.id === t.id);
            return upd ? { ...t, ...upd.partial } : t;
          });
          return {
            talents: [...newBatch, ...merged],
            isImporting: false,
            importProgress: { current: files.length, total: files.length, percent: 100, status: 'done' },
          };
        });
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
  // 按需订阅 + useMemo：仅当 talents/filter 变化时重新过滤排序
  const talents = useTalentStore((s) => s.talents);
  const filter = useTalentStore((s) => s.filter);
  return useMemo(() => talents.filter((t) => {
    // 归档视图：archived=true 只看归档；默认只看活跃（未归档）
    const view = (filter as TalentFilter & { archiveView?: 'active' | 'all' | 'archived' }).archiveView || 'active';
    if (view === 'active' && t.archived) return false;
    if (view === 'archived' && !t.archived) return false;

    if (filter.category !== 'all' && !(t.categories || []).includes(filter.category)) return false;
    if (filter.search) {
      const q = filter.search.toLowerCase();
      const haystack = [
        t.name, t.jobTitle, t.tg, t.notes,
        t.company, t.department, t.techDirection, t.school, t.major, t.location,
        t.organization, t.approvalNo,
        ...(t.prevCompanies || []),
      ].filter(Boolean).join(' ').toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  })
    // 由近及远：新导入/新增的（createdAt 越新）排在最上面；无 createdAt 的老数据沉到末尾
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')), [talents, filter]);
}

export function useTalentCategoryCounts(): { id: JDCategory | 'all'; label: string; count: number }[] {
  const talents = useTalentStore((s) => s.talents);
  const filter = useTalentStore((s) => s.filter);
  return useMemo(() => {
    const view = (filter as TalentFilter & { archiveView?: 'active' | 'all' | 'archived' }).archiveView || 'active';
    const pool = talents.filter((t) => {
      if (view === 'active' && t.archived) return false;
      if (view === 'archived' && !t.archived) return false;
      return true;
    });
    // 一次遍历累加计数（O(n)），替代每个分类各 filter 一遍
    const counts = new Map<JDCategory, number>();
    for (const t of pool) {
      for (const cat of t.categories || []) counts.set(cat, (counts.get(cat) || 0) + 1);
    }
    const entries: { id: JDCategory | 'all'; label: string; count: number }[] = [{ id: 'all', label: '全部', count: pool.length }];
    for (const cat of ALL_CATEGORIES) {
      const count = counts.get(cat) || 0;
      if (count > 0) entries.push({ id: cat, label: JD_CATEGORY_LABELS[cat], count });
    }
    return entries;
  }, [talents, filter]);
}
