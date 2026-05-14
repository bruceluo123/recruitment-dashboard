import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { JD, JDFilter, JDCategory, JDImportResult } from '@/types/jd';
import { JD_CATEGORY_LABELS } from '@/types/jd';
import { MOCK_JDS } from '@/data/mock-jds';
import { generateId } from '@/lib/utils';

export interface ImportProgress {
  current: number; total: number; percent: number;
  status: 'idle' | 'reading' | 'parsing' | 'done';
}

interface JDStore {
  jds: JD[];
  filter: JDFilter;
  selectedJdId: string | null;
  isImporting: boolean;
  importProgress: ImportProgress;
  selectJD: (id: string | null) => void;
  setFilter: (partial: Partial<JDFilter>) => void;
  resetFilter: () => void;
  addJdBatch: (jds: JD[]) => void;
  updateJD: (id: string, partial: Partial<JD>) => void;
  deleteJD: (id: string) => void;
  importFromExcel: (file: File) => Promise<JDImportResult>;
  toggleActive: (id: string) => void;
}

export const useJDStore = create<JDStore>()(
  persist(
    (set, get) => ({
      jds: MOCK_JDS,
      filter: { search: '', category: 'all' },
      selectedJdId: null,
      isImporting: false,
      importProgress: { current: 0, total: 0, percent: 0, status: 'idle' },

      selectJD: (id) => set({ selectedJdId: id }),
      setFilter: (partial) => set((s) => ({ filter: { ...s.filter, ...partial } })),
      resetFilter: () => set({ filter: { search: '', category: 'all' } }),
      addJdBatch: (jds) => set((s) => ({ jds: [...s.jds, ...jds] })),
      updateJD: (id, partial) => set((s) => ({
        jds: s.jds.map((j) => j.id === id ? { ...j, ...partial, updatedAt: new Date().toISOString() } : j),
      })),
      deleteJD: (id) => set((s) => ({ jds: s.jds.filter((j) => j.id !== id) })),
      toggleActive: (id) => set((s) => ({
        jds: s.jds.map((j) => j.id === id ? { ...j, isActive: !j.isActive } : j),
      })),

      importFromExcel: async (file: File) => {
        set({ isImporting: true, importProgress: { current: 0, total: 0, percent: 0, status: 'reading' } });
        try {
          const buf = await file.arrayBuffer();
          if (!buf?.byteLength) { set({ isImporting: false }); return { success: 0, failed: 0, errors: ['文件为空'] }; }

          const XLSX = await import('xlsx');
          const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
          if (!wb.SheetNames?.length) { set({ isImporting: false }); return { success: 0, failed: 0, errors: ['无工作表'] }; }

          const sheet = wb.Sheets[wb.SheetNames[0]];
          if (!sheet) { set({ isImporting: false }); return { success: 0, failed: 0, errors: ['工作表为空'] }; }

          const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: '' });
          if (!rows?.length) { set({ isImporting: false }); return { success: 0, failed: 0, errors: ['没有数据'] }; }

          // Analyze all headers to find the title column
          const headers = Object.keys(rows[0]);
          const titleCol = findTitleColumn(headers, rows);

          const total = rows.length;
          set({ importProgress: { current: 0, total, percent: 0, status: 'parsing' } });

          const batch: JD[] = [];
          const result: JDImportResult = { success: 0, failed: 0, errors: [] };

          // All columns except title are "content columns"
          const contentCols = headers.filter((h) => h !== titleCol);

          const CHUNK = 10;
          for (let i = 0; i < total; i += CHUNK) {
            const end = Math.min(i + CHUNK, total);
            for (let j = i; j < end; j++) {
              try {
                const row = rows[j];
                if (!row) { result.failed++; continue; }

                const title = String(row[titleCol] || '').trim();
                if (!title) { result.failed++; continue; }

                // Collect ALL content from ALL other columns
                const allText: string[] = [];
                for (const col of contentCols) {
                  const v = String(row[col] || '').trim();
                  if (v && v.length > 2) allText.push(v);
                }

                // Split long text blocks into lines
                const lines = allText
                  .flatMap((s) => s.split(/[；;。\n\r]+/))
                  .map((s) => s.replace(/^[\d]+[.、.\s]*/, '').trim())
                  .filter((s) => s.length > 1);

                // First half of lines → responsibilities, second half → requirements
                const mid = Math.ceil(lines.length / 2);

                batch.push({
                  id: generateId(),
                  title,
                  department: '',
                  category: detectCategory(title),
                  responsibilities: lines.slice(0, mid),
                  requirements: lines.slice(mid),
                  salaryRange: { min: 0, max: 0, currency: 'K' },
                  location: 'remote',
                  isActive: true,
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

          get().addJdBatch(batch);
          set({ isImporting: false, importProgress: { current: 0, total: 0, percent: 100, status: 'done' } });
          return result;
        } catch (err) {
          set({ isImporting: false });
          return { success: 0, failed: 0, errors: [`解析失败: ${(err as Error)?.message || '未知'}`] };
        }
      },
    }),
    { name: 'recruitai-jd-store' },
  ),
);

// ─── Smart title column detection ───

function findTitleColumn(headers: string[], rows: Record<string, string>[]): string {
  // 1. Exact header match
  const TITLE_WORDS = ['岗位名称', '职位名称', '职位', '岗位', '职务', 'title', 'position', '名称', '角色'];
  for (const h of headers) {
    const hLower = h.toLowerCase().replace(/\s+/g, '');
    for (const w of TITLE_WORDS) {
      if (hLower === w || hLower.includes(w)) return h;
    }
  }

  // 2. Score each column: ideal title = short values, high uniqueness, non-numeric
  let bestCol = headers[0];
  let bestScore = -1;

  for (const h of headers) {
    const vals = rows.map((r) => String(r[h] || '').trim()).filter(Boolean);
    if (vals.length === 0) continue;

    const avgLen = vals.reduce((s, v) => s + v.length, 0) / vals.length;
    const uniqueRatio = new Set(vals).size / vals.length;
    const hasNumbers = vals.some((v) => /^\d+$/.test(v) || /^\d+[-~]\d+/.test(v));

    // Score: prefer short values (3-25 chars), high uniqueness, no salary patterns
    let score = 0;
    if (avgLen >= 3 && avgLen <= 25) score += 40;
    if (avgLen <= 15) score += 20;
    if (uniqueRatio > 0.5) score += 20;
    if (!hasNumbers) score += 20;

    if (score > bestScore) { bestScore = score; bestCol = h; }
  }

  return bestCol;
}

// ─── Category detection ───

const CATEGORY_KEYWORDS: [JDCategory, RegExp][] = [
  ['seo', /seo|搜索引擎|关键词/i],
  ['advertising', /广告|信息流|投放|sem|feed|千川/i],
  ['gaming', /游戏|unity|unreal|ue[45]|cocos/i],
  ['ai', /人工智能|大模型|llm|gpt|prompt| ai /i],
  ['algorithm', /算法|推荐|nlp|机器学习|深度学习|计算机视觉/i],
  ['frontend', /前端|web|react|vue|h5|小程序/i],
  ['backend', /后端|java|go|golang|php|ruby|服务端/i],
  ['devops', /运维|devops|k8s|kubernetes|docker|ci.*cd|监控/i],
  ['testing', /测试|qa|质量/i],
  ['product-design', /ui|ux|设计|视觉|插画|动效|产品设计/i],
  ['finance', /财务|会计|出纳|审计|税务/i],
  ['hr', /hr|人力|招聘|薪酬|培训|员工关系|组织发展/i],
  ['bd', /商务|bd|拓展|渠道|合作|销售/i],
  ['customer-service', /客服|客户服务|售后/i],
  ['operations', /运营|电商|直播运营|带货|主播|中控|场控|选品/i],
  ['project', /项目|pmo|scrum/i],
  ['director', /总监|vp|副总裁|cto|ceo|负责人/i],
  ['administration', /行政|前台|助理|秘书|档案|车辆|办公室/i],
];

function detectCategory(text: string): JDCategory {
  const t = text.toLowerCase();
  for (const [cat, re] of CATEGORY_KEYWORDS) { if (re.test(t)) return cat; }
  return 'operations';
}

// ─── Selectors ───

export function useFilteredJDs(): JD[] {
  const { jds, filter } = useJDStore();
  return jds.filter((jd) => {
    if (filter.category !== 'all' && jd.category !== filter.category) return false;
    if (filter.search) {
      const q = filter.search.toLowerCase();
      const haystack = [jd.title, jd.department, ...jd.responsibilities, ...jd.requirements].join(' ').toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    if (filter.department && jd.department !== filter.department) return false;
    if (filter.isActive !== undefined && jd.isActive !== filter.isActive) return false;
    return true;
  });
}

const ALL_CATS: JDCategory[] = ['frontend','devops','administration','advertising','gaming','backend','operations','product-design','finance','algorithm','customer-service','project','ai','testing','hr','bd','seo','director'];

export function useCategoryCounts(): { id: JDCategory | 'all'; label: string; count: number }[] {
  const { jds } = useJDStore();
  const entries: { id: JDCategory | 'all'; label: string; count: number }[] = [{ id: 'all', label: '全部', count: jds.length }];
  for (const cat of ALL_CATS) {
    entries.push({ id: cat, label: JD_CATEGORY_LABELS[cat], count: jds.filter((j) => j.category === cat).length });
  }
  return entries;
}
