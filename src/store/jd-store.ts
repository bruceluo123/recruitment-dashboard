import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { JD, JDFilter, JDCategory, JDImportResult, JDStatus } from '@/types/jd';
import { hasCategory, parsePriority } from '@/types/jd';
import { JD_CATEGORY_LABELS, JD_STATUS_LABELS } from '@/types/jd';
import { MOCK_JDS } from '@/data/mock-jds';
import { generateId } from '@/lib/utils';
import { parseMultipleJDs, type ParsedJD } from '@/lib/jd-parser';
import {
  analyzeColumns,
  detectCategories,
  isAllowedTitleHeader,
  mergeUniqueJDs,
  normalizeExcelRows,
  parseSalary,
  splitJDBySection,
  stripContactMeta,
} from '@/lib/jd-parse-core';

export interface ImportProgress {
  current: number; total: number; percent: number;
  status: 'idle' | 'reading' | 'parsing' | 'done';
}

interface JDStore {
  jds: JD[];
  filter: JDFilter;
  selectedJdId: string | null;
  isImporting: boolean;
  importCancelled: boolean;
  importProgress: ImportProgress;
  cancelImport: () => void;
  selectJD: (id: string | null) => void;
  setFilter: (partial: Partial<JDFilter>) => void;
  resetFilter: () => void;
  addJdBatch: (jds: JD[]) => void;
  updateJD: (id: string, partial: Partial<JD>) => void;
  deleteJD: (id: string) => void;
  deleteJDBatch: (ids: string[]) => void;
  undoDeleteJD: () => void;
  lastDeletedJD: JD | null;
  importFromExcel: (file: File) => Promise<JDImportResult>;
  cycleStatus: (id: string) => void;
  cleanAllJDs: () => void;
  exportAllJDs: () => void;
  backupToKV: () => Promise<void>;
}

export const useJDStore = create<JDStore>()(
  persist(
    (set, get) => ({
      jds: MOCK_JDS,
      filter: { search: '', category: 'all' },
      selectedJdId: null,
      isImporting: false,
      importCancelled: false,
      importProgress: { current: 0, total: 0, percent: 0, status: 'idle' },
      cancelImport: () => set({ importCancelled: true }),

      selectJD: (id) => set({ selectedJdId: id }),
      setFilter: (partial) => set((s) => ({ filter: { ...s.filter, ...partial } })),
      resetFilter: () => set({ filter: { search: '', category: 'all' } }),
      addJdBatch: (jds) => set((s) => ({ jds: mergeUniqueJDs(s.jds, jds).jds })),
      updateJD: (id, partial) => set((s) => ({
        jds: s.jds.map((j) => j.id === id ? { ...j, ...partial, updatedAt: new Date().toISOString() } : j),
      })),
      deleteJD: (id) => set((s) => {
        const target = s.jds.find((j) => j.id === id);
        return { jds: s.jds.filter((j) => j.id !== id), lastDeletedJD: target || null };
      }),
      deleteJDBatch: (ids) => set((s) => {
        const idSet = new Set(ids);
        return { jds: s.jds.filter((j) => !idSet.has(j.id)), lastDeletedJD: null };
      }),
      undoDeleteJD: () => set((s) => {
        if (!s.lastDeletedJD) return {};
        return { jds: [...s.jds, s.lastDeletedJD], lastDeletedJD: null };
      }),
      lastDeletedJD: null,
      cycleStatus: (id) => set((s) => ({
        jds: s.jds.map((j) => {
          if (j.id !== id) return j;
          const next: JDStatus = j.status === 'active' ? 'urgent' : j.status === 'urgent' ? 'paused' : 'active';
          return { ...j, status: next };
        }),
      })),
      cleanAllJDs: () => set((s) => ({
        jds: s.jds.map((j) => ({
          ...j,
          responsibilities: stripContactMeta(j.responsibilities.map((r: string) => r.replace(/^[\d]+[.、.\s]*/, '').trim()).filter(Boolean)),
          requirements: stripContactMeta(j.requirements.map((r: string) => r.replace(/^[\d]+[.、.\s]*/, '').trim()).filter(Boolean)),
        })),
      })),

      exportAllJDs: () => {
        const jds = get().jds;
        exportJDsWithTemplate(jds);
      },

      backupToKV: async () => {
        const jds = get().jds;
        if (jds.length > 0 && jds.every((j) => j.id.startsWith('jd-00'))) {
          alert('当前为示例数据，不能备份。请先导入真实岗位数据。');
          return;
        }
        if (!confirm(`即将把当前 ${jds.length} 条岗位合并备份到云端。\n\n系统会先读取云端已有岗位，再合并去重后写回，避免直接覆盖导致数据丢失。是否继续？`)) {
          return;
        }
        try {
          let dataToBackup = jds;
          const remoteRes = await fetch('/api/data?type=jds');
          if (remoteRes.ok) {
            const remote = await remoteRes.json();
            const remoteJds = Array.isArray(remote?.data) ? remote.data as JD[] : [];
            dataToBackup = mergeUniqueJDs(remoteJds, jds).jds;
          }
          const res = await fetch('/api/data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'jds', data: dataToBackup }),
          });
          if (res.ok) {
            alert(`备份完成：云端当前共 ${dataToBackup.length} 条岗位。`);
            console.log('Backup to KV: OK');
          }
        } catch {
          alert('备份失败：当前网络或云端接口不可用。');
        }
      },

      importFromExcel: async (file: File) => {
        set({ isImporting: true, importCancelled: false, importProgress: { current: 0, total: 0, percent: 0, status: 'reading' } });
        try {
          const buf = await file.arrayBuffer();
          if (!buf?.byteLength) { set({ isImporting: false }); return { success: 0, failed: 0, errors: ['文件为空'] }; }

          const XLSX = await import('xlsx');
          const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
          if (!wb.SheetNames?.length) { set({ isImporting: false }); return { success: 0, failed: 0, errors: ['无工作表'] }; }

          const sheet = wb.Sheets[wb.SheetNames[0]];
          if (!sheet) { set({ isImporting: false }); return { success: 0, failed: 0, errors: ['工作表为空'] }; }

          const rawRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });
          const rows = normalizeExcelRows(rawRows);
          if (!rows?.length) { set({ isImporting: false }); return { success: 0, failed: 0, errors: ['没有数据'] }; }

          // Analyze headers: find title, salary, department, location columns
          const headers = Object.keys(rows[0]);
          const cols = analyzeColumns(headers);
          if (!cols) {
            set({ isImporting: false });
            return { success: 0, failed: rows.length, errors: ['未找到岗位名称列，请使用表头：岗位名称 / 职位名称 / 岗位 / 职位 / title / job_title'] };
          }
          const { titleCol, salaryCol, deptCol, locCol, orgCol, serviceCol, hcCol, vacancyCol, priorityCol, contentCols } = cols;

          const total = rows.length;
          set({ importProgress: { current: 0, total, percent: 0, status: 'parsing' } });

          const batch: JD[] = [];
          const result: JDImportResult = { success: 0, failed: 0, errors: [] };

          // Check which rows need AI (long unstructured text)
          const rowTexts = rows.map((r) =>
            contentCols.map((c) => String(r[c] || '').trim()).filter(Boolean).join('\n'));
          const needAI = rowTexts.map((t) => t.length > 200); // Long text → needs AI

          // AI batch parse rows that need it
          const aiResults: (ParsedJD | null)[] = new Array(total).fill(null);
          const aiIndices = needAI.map((n, i) => n ? i : -1).filter(i => i >= 0);
          if (aiIndices.length > 0) {
            const aiBatchSize = 5;
            for (let b = 0; b < aiIndices.length; b += aiBatchSize) {
              if (get().importCancelled) {
                set({ isImporting: false, importCancelled: false });
                return { success: 0, failed: 0, errors: ['已取消导入'] };
              }
              const batch = aiIndices.slice(b, b + aiBatchSize);
              const texts = batch.map((idx) => rowTexts[idx]);
              const parsed = await parseMultipleJDs(texts);
              batch.forEach((idx, k) => { aiResults[idx] = parsed[k] || null; });
              const pct = Math.round(((b + aiBatchSize) / aiIndices.length) * 30);
              set({ importProgress: { current: b + aiBatchSize, total: aiIndices.length, percent: pct, status: 'parsing' } });
            }
          }

          const CHUNK = 10;
          for (let i = 0; i < total; i += CHUNK) {
            if (get().importCancelled) {
              set({ isImporting: false, importCancelled: false });
              return { success: 0, failed: 0, errors: ['已取消导入'] };
            }
            const end = Math.min(i + CHUNK, total);
            for (let j = i; j < end; j++) {
              try {
                const row = rows[j];
                const ai = aiResults[j];
                if (!row) { result.failed++; result.errors.push(`第${j + 1}行: 数据为空`); continue; }

                // Skip repeated section header rows mid-sheet
                const rawTitleCell = String(row[titleCol] || '').trim();
                if (rawTitleCell && isAllowedTitleHeader(rawTitleCell)) continue;

                let title: string;
                let department: string;
                let rawSalary: string;
                let location: string;
                let responsibilities: string[] = [];
                let requirements: string[] = [];

                const organization = orgCol ? String(row[orgCol] || '').trim() : '';
                const serviceUnit = serviceCol ? String(row[serviceCol] || '').trim() : '';
                const headcount = hcCol ? String(row[hcCol] || '').trim() : '';
                const gap = vacancyCol ? String(row[vacancyCol] || '').trim() : '';
                const priority = priorityCol ? parsePriority(String(row[priorityCol] || '').trim()) : undefined;

                if (ai) {
                  title = String(row[titleCol] || '').trim();
                  if (!title) { result.failed++; result.errors.push(`第${j + 1}行: 缺少岗位名称（列"${titleCol}"为空）`); continue; }
                  department = serviceUnit || ai.department || (deptCol ? String(row[deptCol] || '').trim() : '') || organization;
                  rawSalary = salaryCol ? String(row[salaryCol] || '').trim() : ai.salary || '';
                  location = ai.location || (locCol ? String(row[locCol] || '').trim() : 'remote');
                  responsibilities = Array.isArray(ai.responsibilities) ? ai.responsibilities : [];
                  requirements = Array.isArray(ai.requirements) ? ai.requirements : [];
                } else {
                  title = String(row[titleCol] || '').trim();
                  if (!title) { result.failed++; result.errors.push(`第${j + 1}行: 缺少岗位名称（列"${titleCol}"为空）`); continue; }
                  rawSalary = salaryCol ? String(row[salaryCol] || '').trim() : '';
                  department = serviceUnit || (deptCol ? String(row[deptCol] || '').trim() : '') || organization;
                  location = locCol ? String(row[locCol] || '').trim() : 'remote';

                  // Collect content, keeping column order
                  const allText: string[] = [];
                  for (const col of contentCols) {
                    const v = String(row[col] || '').trim();
                    if (v && v.length > 1) allText.push(v);
                  }
                  // Split by section headers if present, otherwise by punctuation
                  const combined = allText.join('\n');
                  const split = splitJDBySection(combined);
                  responsibilities = split.responsibilities;
                  requirements = split.requirements;
                }

                const isNegotiable = /面议|open|negotiable/i.test(rawSalary);
                const hasExtra = rawSalary && !isNegotiable && !/^[\d.]+[-~至到][\d.]+[kKw万Uu]?$/i.test(rawSalary.replace(/[,，\s]/g, ''));

                batch.push({
                  id: generateId(),
                  title,
                  department,
                  organization: organization || undefined,
                  serviceUnit: serviceUnit || undefined,
                  headcount: headcount || undefined,
                  gap: gap || undefined,
                  priority,
                  categories: detectCategories(title),
                  responsibilities: stripContactMeta(responsibilities),
                  requirements: stripContactMeta(requirements),
                  salaryRange: isNegotiable ? { min: 0, max: 0, currency: 'K' } : parseSalary(rawSalary),
                  salaryText: (isNegotiable || hasExtra) ? rawSalary : undefined,
                  location: location || 'remote',
                  status: 'active',
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                });
                result.success++;
              } catch { result.failed++; }
            }
            const pct = Math.min(100, Math.round((Math.min(end, total) / total) * 100));
            set({ importProgress: { current: Math.min(end, total), total, percent: pct, status: 'parsing' } });
            await new Promise((r) => setTimeout(r, 0));
          }

          const merged = mergeUniqueJDs(get().jds, batch);
          useJDStore.setState({ jds: merged.jds });
          if (merged.skipped > 0) {
            result.success -= merged.skipped;
            result.failed += merged.skipped;
            result.errors.push(`已自动跳过 ${merged.skipped} 条重复岗位`);
          }
          set({ isImporting: false, importProgress: { current: 0, total: 0, percent: 100, status: 'done' } });
          return result;
        } catch (err) {
          set({ isImporting: false });
          return { success: 0, failed: 0, errors: [`解析失败: ${(err as Error)?.message || '未知'}`] };
        }
      },
    }),
    { name: 'recruitai-jd-store', version: 4,
      partialize: (state) => {
        // Exclude transient import state — always reset on page reload
        const { isImporting, importCancelled, importProgress, cancelImport, ...rest } = state;
        void isImporting; void importCancelled; void importProgress; void cancelImport;
        return rest;
      },
      migrate: (old: unknown) => {
        const state = old as { jds?: Array<Record<string, unknown>> };
        const jds = state.jds || [];
        return {
          jds: jds.map((jd: Record<string, unknown>) => {
            const fixed = { ...jd };
            // Migrate isActive → status
            if (!fixed.status && fixed.isActive !== undefined) {
              fixed.status = fixed.isActive ? 'active' : 'paused';
              delete fixed.isActive;
            }
            if (!fixed.status) fixed.status = 'active';
            // Migrate category → categories, with old→new name map
            if (fixed.category && !fixed.categories) {
              const oldCat = fixed.category as string;
              const map: Record<string, string> = {
                'product-design': 'design',
              };
              fixed.categories = [map[oldCat] || oldCat];
              delete fixed.category;
            }
            if (!fixed.categories || !(fixed.categories as unknown[]).length) {
              fixed.categories = ['operations'];
            }
            // v4: 清理混入职责/要求的联系人/来源/部门元数据（来源表格/对应ODC/对应SSC/@TG/主管等）
            if (Array.isArray(fixed.responsibilities)) {
              fixed.responsibilities = stripContactMeta((fixed.responsibilities as unknown[]).map(String));
            }
            if (Array.isArray(fixed.requirements)) {
              fixed.requirements = stripContactMeta((fixed.requirements as unknown[]).map(String));
            }
            return fixed;
          }),
        } as unknown as JDStore;
      },
    },
  ),
);

function formatExportList(items: string[]): string {
  return items.map((item, index) => `${index + 1}. ${item}`).join('\n');
}

// 导出列：与 JD 库表格列保持一致，并附带完整文本字段（职责/要求/加分项）
const EXPORT_COLUMNS: Array<{ header: string; key: string; width: number; wrap?: boolean }> = [
  { header: '岗位名称', key: 'title', width: 26 },
  { header: '优先级', key: 'priority', width: 10 },
  { header: '分类', key: 'categories', width: 14 },
  { header: 'HC', key: 'headcount', width: 8 },
  { header: '缺口', key: 'gap', width: 8 },
  { header: '编制组织', key: 'organization', width: 16 },
  { header: '服务单位', key: 'serviceUnit', width: 16 },
  { header: '对接ODC', key: 'odc', width: 18 },
  { header: '薪资', key: 'salary', width: 18 },
  { header: '状态', key: 'status', width: 10 },
  { header: '地点', key: 'location', width: 12 },
  { header: '部门', key: 'department', width: 16 },
  { header: '职责', key: 'responsibilities', width: 70, wrap: true },
  { header: '要求', key: 'requirements', width: 70, wrap: true },
  { header: '加分项', key: 'preferred', width: 50, wrap: true },
];

function jdToExportRow(jd: JD): Record<string, string> {
  return {
    title: jd.title || '',
    priority: jd.priority || '',
    categories: jd.categories.map((c) => JD_CATEGORY_LABELS[c]).join(' / '),
    headcount: jd.headcount || '',
    gap: jd.gap || '',
    organization: jd.organization || '',
    serviceUnit: jd.serviceUnit || jd.department || '',
    odc: jd.odc || '',
    salary: jd.salaryText || (jd.salaryRange.min ? `${jd.salaryRange.min} - ${jd.salaryRange.max}${jd.salaryRange.currency}` : ''),
    status: JD_STATUS_LABELS[jd.status],
    location: jd.location || 'remote',
    department: jd.department || '',
    responsibilities: formatExportList(jd.responsibilities),
    requirements: formatExportList(jd.requirements),
    preferred: formatExportList(jd.preferredQualifications || []),
  };
}

async function exportJDsWithTemplate(jds: JD[]): Promise<void> {
  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('岗位库');

  worksheet.columns = EXPORT_COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));

  // 表头样式
  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
  headerRow.height = 24;

  jds.forEach((jd) => {
    const row = worksheet.addRow(jdToExportRow(jd));
    row.alignment = { vertical: 'top', wrapText: true };
  });

  worksheet.views = [{ state: 'frozen', ySplit: 1 }];

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `JD岗位库_${new Date().toISOString().slice(0, 10)}.xlsx`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ─── Selectors ───

export function useFilteredJDs(): JD[] {
  const { jds, filter } = useJDStore();
  return jds.filter((jd) => {
    if (filter.category !== 'all' && !hasCategory(jd, filter.category)) return false;
    if (filter.search) {
      const q = filter.search.toLowerCase();
      const haystack = [jd.title, jd.department, ...jd.responsibilities, ...jd.requirements].join(' ').toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    if (filter.department && jd.department !== filter.department) return false;
    if (filter.status && jd.status !== filter.status) return false;
    return true;
  });
}

const ALL_CATS: JDCategory[] = ['frontend','devops','administration','advertising','gaming','backend','operations','product','design','finance','algorithm','customer-service','project','ai','testing','hr','bd','seo','director','data','hardware'];

export function useCategoryCounts(): { id: JDCategory | 'all'; label: string; count: number }[] {
  const { jds } = useJDStore();
  const entries: { id: JDCategory | 'all'; label: string; count: number }[] = [{ id: 'all', label: '全部', count: jds.length }];
  for (const cat of ALL_CATS) {
    entries.push({ id: cat, label: JD_CATEGORY_LABELS[cat], count: jds.filter((j) => hasCategory(j, cat)).length });
  }
  return entries;
}
