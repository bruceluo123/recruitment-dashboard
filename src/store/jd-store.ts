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
  cleanAllJDs: () => void;
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
      cleanAllJDs: () => set((s) => ({
        jds: s.jds.map((j) => ({
          ...j,
          responsibilities: j.responsibilities.map((r: string) => r.replace(/^[\d]+[.、.\s]*/, '').trim()).filter(Boolean),
          requirements: j.requirements.map((r: string) => r.replace(/^[\d]+[.、.\s]*/, '').trim()).filter(Boolean),
        })),
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

          // Analyze headers: find title, salary, department, location columns
          const headers = Object.keys(rows[0]);
          const titleCol = findTitleColumn(headers, rows);
          const salaryCol = findColumnByKeywords(headers, SALARY_KEYS);
          const deptCol = findColumnByKeywords(headers, DEPT_KEYS);
          const locCol = findColumnByKeywords(headers, LOC_KEYS);

          // Content columns = everything not matched to a known field
          const knownCols = new Set([titleCol, salaryCol, deptCol, locCol].filter(Boolean));
          const contentCols = headers.filter((h) => !knownCols.has(h));

          const total = rows.length;
          set({ importProgress: { current: 0, total, percent: 0, status: 'parsing' } });

          const batch: JD[] = [];
          const result: JDImportResult = { success: 0, failed: 0, errors: [] };

          const CHUNK = 10;
          for (let i = 0; i < total; i += CHUNK) {
            const end = Math.min(i + CHUNK, total);
            for (let j = i; j < end; j++) {
              try {
                const row = rows[j];
                if (!row) { result.failed++; result.errors.push(`第${j + 1}行: 数据为空`); continue; }

                const title = String(row[titleCol] || '').trim();
                if (!title) { result.failed++; result.errors.push(`第${j + 1}行: 缺少岗位名称（列"${titleCol}"为空）`); continue; }

                const rawSalary = salaryCol ? String(row[salaryCol] || '').trim() : '';
                // Detect non-numeric salary like "面议"
                const isNegotiable = /面议|open|negotiable/i.test(rawSalary);
                // Check if salary has extra info beyond a simple range (like "+绩效", "+年终")
                const hasExtra = rawSalary && !isNegotiable && !/^[\d.]+[-~至到][\d.]+[kKw万Uu]?$/i.test(rawSalary.replace(/[,，\s]/g, ''));
                const department = deptCol ? String(row[deptCol] || '').trim() : '';
                const location = locCol ? String(row[locCol] || '').trim() : 'remote';

                // Collect content from unlabeled columns
                const allText: string[] = [];
                for (const col of contentCols) {
                  const v = String(row[col] || '').trim();
                  if (v && v.length > 2) allText.push(v);
                }

                const lines = allText
                  .flatMap((s) => s.split(/[；;。\n\r]+/))
                  .map((s) => s.replace(/^[\d]+[.、.\s]*/, '').trim())
                  .filter((s) => s.length > 1);

                const mid = Math.ceil(lines.length / 2);

                batch.push({
                  id: generateId(),
                  title,
                  department,
                  category: detectCategory(title + ' ' + department),
                  responsibilities: lines.slice(0, mid),
                  requirements: lines.slice(mid),
                  salaryRange: isNegotiable ? { min: 0, max: 0, currency: 'K' } : parseSalary(rawSalary),
                  salaryText: (isNegotiable || hasExtra) ? rawSalary : undefined,
                  location: location || 'remote',
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

// ─── Column keyword lists ───

const SALARY_KEYS = ['薪酬', '薪资', '工资', '待遇', '月薪', '年薪', '薪酬与福利', '薪酬福利', '薪资待遇', '薪酬范围', '薪资范围', '薪资水平', '工资待遇', '薪水', '报酬', 'salary', 'compensation', '底薪', '底薪范围', '综合薪资', '总包', '年包'];
const DEPT_KEYS = ['部门', '所属部门', '用人部门', '工作部门', '事业部', '团队', '组织', 'department', 'dept', '所在部门', '归属部门', '职能部门'];
const LOC_KEYS = ['地点', '工作地点', '城市', '工作城市', '办公地点', '所在地', '工作地址', '地址', 'location', 'city', 'base'];

// ─── Column detection helpers ───

function findColumnByKeywords(headers: string[], keywords: string[]): string | null {
  for (const h of headers) {
    const hLower = h.toLowerCase().replace(/\s+/g, '');
    for (const kw of keywords) {
      if (hLower === kw.toLowerCase().replace(/\s+/g, '') || hLower.includes(kw.toLowerCase().replace(/\s+/g, ''))) {
        return h;
      }
    }
  }
  return null;
}

function findTitleColumn(headers: string[], rows: Record<string, string>[]): string {
  // First try keyword match
  const TITLE_WORDS = ['岗位名称', '职位名称', '职位', '岗位', '职务', '招聘岗位', 'title', 'position', '名称', '角色', '岗位名'];
  const kwMatch = findColumnByKeywords(headers, TITLE_WORDS);
  if (kwMatch) return kwMatch;

  // Fallback: Score each column: ideal title = short values, high uniqueness, non-numeric
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
  ['frontend', /前端|web|react|vue|h5|小程序|安卓|android|ios|移动端|flutter|客户端/i],
  ['backend', /后端|java|go|golang|php|ruby|服务端|python|c\+\+|c#|\.net|架构师/i],
  ['devops', /运维|devops|k8s|kubernetes|docker|ci.*cd|监控/i],
  ['testing', /测试|qa|质量/i],
  ['product', /产品经理|产品总监|产品负责人|产品助理/i],
  ['design', /ui|ux|设计|视觉|插画|动效/i],
  ['finance', /财务|会计|出纳|审计|税务/i],
  ['data', /数据|数据挖掘|爬虫|etl|数据仓库|数据分析|数据工程|大数据/i],
  ['hardware', /gpu|硬件|芯片|嵌入式|固件|pcb|电路|cpu/i],
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
  // Broad fallbacks before defaulting
  if (/开发|程序|码农|软件/i.test(t)) return 'backend';
  if (/设计|画|创作|创意/i.test(t)) return 'design';
  if (/产品|需求|原型|用户研究/i.test(t)) return 'product';
  if (/数据|报表|指标|数仓/i.test(t)) return 'data';
  if (/市场|营销|品牌|推广/i.test(t)) return 'advertising';
  if (/管理|经理|主管|负责/i.test(t)) return 'administration';
  return 'operations';
}

function parseSalary(s: string): { min: number; max: number; currency: string } {
  if (!s) return { min: 0, max: 0, currency: 'K' };
  try {
    const cleaned = String(s).replace(/[,，\s]/g, '');
    // Try various formats: "15K-25K", "15k-25k", "15000-25000", "1.5万-2.5万"
    let match = cleaned.match(/(\d+\.?\d*)\s*[-~至到]\s*(\d+\.?\d*)\s*([kKw万])?/i);
    if (match) {
      let mult = 1;
      if (match[3]?.toLowerCase() === '万') mult = 10;
      else if (match[3]?.toLowerCase() === 'k') mult = 1;
      // If no K/W suffix and values > 100, treat as raw numbers (e.g. "15000")
      else if (!match[3] && parseInt(match[1]) > 100) mult = 0.001; // convert to K
      const min = Math.min(parseFloat(match[1]) * mult, 999);
      const max = Math.min(parseFloat(match[2]) * mult, 999);
      return { min: Math.max(0, Math.round(min)), max: Math.max(Math.round(min), Math.round(max)), currency: 'K' };
    }
    // Single number: "15K" or "15000"
    match = cleaned.match(/^(\d+\.?\d*)\s*([kKw万])?$/i);
    if (match) {
      let mult = 1;
      if (match[2]?.toLowerCase() === '万') mult = 10;
      else if (!match[2] && parseInt(match[1]) > 100) mult = 0.001;
      const val = Math.round(parseFloat(match[1]) * mult);
      return { min: val, max: val, currency: 'K' };
    }
  } catch { /* */ }
  return { min: 0, max: 0, currency: 'K' };
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

const ALL_CATS: JDCategory[] = ['frontend','devops','administration','advertising','gaming','backend','operations','product','design','finance','algorithm','customer-service','project','ai','testing','hr','bd','seo','director','data','hardware'];

export function useCategoryCounts(): { id: JDCategory | 'all'; label: string; count: number }[] {
  const { jds } = useJDStore();
  const entries: { id: JDCategory | 'all'; label: string; count: number }[] = [{ id: 'all', label: '全部', count: jds.length }];
  for (const cat of ALL_CATS) {
    entries.push({ id: cat, label: JD_CATEGORY_LABELS[cat], count: jds.filter((j) => j.category === cat).length });
  }
  return entries;
}
