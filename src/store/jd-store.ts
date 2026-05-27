import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { JD, JDFilter, JDCategory, JDImportResult, JDStatus } from '@/types/jd';
import { hasCategory } from '@/types/jd';
import { JD_CATEGORY_LABELS } from '@/types/jd';
import { MOCK_JDS } from '@/data/mock-jds';
import { generateId } from '@/lib/utils';
import { parseMultipleJDs, type ParsedJD } from '@/lib/jd-parser';

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
      importProgress: { current: 0, total: 0, percent: 0, status: 'idle' },

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
          responsibilities: j.responsibilities.map((r: string) => r.replace(/^[\d]+[.、.\s]*/, '').trim()).filter(Boolean),
          requirements: j.requirements.map((r: string) => r.replace(/^[\d]+[.、.\s]*/, '').trim()).filter(Boolean),
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
        set({ isImporting: true, importProgress: { current: 0, total: 0, percent: 0, status: 'reading' } });
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
          const titleCol = findTitleColumn(headers);
          if (!titleCol) {
            set({ isImporting: false });
            return { success: 0, failed: rows.length, errors: ['未找到岗位名称列，请使用表头：岗位名称 / 职位名称 / 岗位 / 职位 / title / job_title'] };
          }
          const salaryCol = findColumnByKeywords(headers, SALARY_KEYS);
          const deptCol = findColumnByKeywords(headers, DEPT_KEYS);
          const locCol = findColumnByKeywords(headers, LOC_KEYS);
          const orgCol = findColumnByKeywords(headers, ORG_KEYS);
          const serviceCol = findColumnByKeywords(headers, SERVICE_KEYS);
          const hcCol = findColumnByKeywords(headers, HC_KEYS);
          const vacancyCol = findColumnByKeywords(headers, VACANCY_KEYS);
          const skipCols = headers.filter((h) => matchesAnyKeyword(h, SKIP_KEYS));

          // Content columns = everything not matched to a known field
          const knownCols = new Set<string>(
            [titleCol, salaryCol, deptCol, locCol, orgCol, serviceCol, hcCol, vacancyCol, ...skipCols]
              .filter((x): x is string => x !== null)
          );
          const contentCols = headers.filter((h) => !knownCols.has(h));

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
                  categories: detectCategories(title + ' ' + department),
                  responsibilities,
                  requirements,
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
    { name: 'recruitai-jd-store', version: 3,
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
            return fixed;
          }),
        };
      },
    },
  ),
);

// ─── Column keyword lists ───

const SALARY_KEYS = ['薪酬', '薪资', '工资', '待遇', '月薪', '年薪', '薪酬与福利', '薪酬福利', '薪资待遇', '薪酬范围', '薪资范围', '薪资区间', '薪资水平', '工资待遇', '薪水', '报酬', 'salary', 'compensation', '底薪', '底薪范围', '综合薪资', '总包', '年包'];
const DEPT_KEYS = ['部门', '所属部门', '用人部门', '工作部门', '事业部', '团队', 'department', 'dept', '所在部门', '归属部门', '职能部门'];
const LOC_KEYS = ['地点', '工作地点', '城市', '工作城市', '办公地点', '所在地', '工作地址', '地址', 'location', 'city', 'base'];
const TITLE_KEYS = ['岗位名称', '职位名称', '岗位', '职位', 'title', 'job_title'];
const EXCLUDED_TITLE_KEYS = ['序号', '编号', 'id', '自动序号', 'no', 'index'];
const ORG_KEYS = ['编制组织', '编制', '所属公司', '归属公司', '归属组织'];
const SERVICE_KEYS = ['服务单位', '所属单位', '业务单位', '所在单位'];
const HC_KEYS = ['hc', 'headcount', '招聘人数', '编制数', '人数', 'hc数'];
const VACANCY_KEYS = ['缺口', '空缺', '待招', '招聘缺口'];
const SKIP_KEYS = ['已到岗', '已发offer', '待入职', '提需日期', '期望到岗日期', '期望到岗'];

// ─── Column detection helpers ───

function normalizeExcelRows(rawRows: unknown[][]): Record<string, string>[] {
  const rows = rawRows
    .map((row) => row.map((cell) => String(cell || '').trim()))
    .filter((row) => row.some(Boolean));

  if (!rows.length) return [];

  // Find the first header row in the first 5 rows (handles sheets with leading blank/metadata rows)
  const headerRowIdx = rows.slice(0, 5).findIndex(looksLikeHeaderRow);
  if (headerRowIdx >= 0) {
    const headers = rows[headerRowIdx].map((h, i) => h || `列${i + 1}`);
    return rows.slice(headerRowIdx + 1).map((row) => {
      const item: Record<string, string> = {};
      headers.forEach((header, i) => { item[header] = row[i] || ''; });
      return item;
    });
  }

  const headers = ['岗位名称', '岗位内容', '薪资', '部门', '备注', '备注2', '备注3', '备注4', '备注5'];
  return rows.map((row) => {
    const item: Record<string, string> = {};
    row.forEach((cell, i) => { item[headers[i] || `列${i + 1}`] = cell; });
    return item;
  });
}

function looksLikeHeaderRow(row: string[]): boolean {
  const compactCells = row.filter(Boolean);
  if (!compactCells.length) return false;
  const matched = compactCells.filter((cell) =>
    matchesAnyKeyword(cell, TITLE_KEYS) ||
    matchesAnyKeyword(cell, SALARY_KEYS) ||
    matchesAnyKeyword(cell, DEPT_KEYS) ||
    matchesAnyKeyword(cell, LOC_KEYS) ||
    matchesAnyKeyword(cell, ORG_KEYS) ||
    matchesAnyKeyword(cell, SERVICE_KEYS) ||
    matchesAnyKeyword(cell, HC_KEYS) ||
    matchesAnyKeyword(cell, VACANCY_KEYS)
  ).length;
  const hasLongContent = compactCells.some((cell) => cell.length > 80);
  return matched >= 2 && !hasLongContent;
}

function matchesAnyKeyword(value: string, keywords: string[]): boolean {
  const normalized = value.toLowerCase().replace(/\s+/g, '');
  return keywords.some((kw) => {
    const key = kw.toLowerCase().replace(/\s+/g, '');
    return normalized === key || normalized.includes(key);
  });
}

function findColumnByKeywords(headers: string[], keywords: string[]): string | null {
  for (const h of headers) {
    if (matchesAnyKeyword(h, keywords)) return h;
  }
  return null;
}

function findTitleColumn(headers: string[]): string | null {
  return headers.find((h) => isAllowedTitleHeader(h) && !isExcludedTitleHeader(h)) || null;
}

function isAllowedTitleHeader(header: string): boolean {
  const normalized = normalizeHeader(header);
  return TITLE_KEYS.some((key) => normalized === normalizeHeader(key));
}

function isExcludedTitleHeader(header: string): boolean {
  const normalized = normalizeHeader(header);
  return EXCLUDED_TITLE_KEYS.some((key) => normalized === normalizeHeader(key));
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[\s()（）]/g, '');
}

function splitJDBySection(text: string): { responsibilities: string[]; requirements: string[] } {
  const RESP_HEADER = /^(【工作内容】|【岗位职责】|【工作职责】|【工作描述】|工作内容[：:。]?|岗位职责[：:。]?|工作职责[：:。]?)/;
  const REQ_HEADER = /^(【任职要求】|【岗位要求】|【岗位需求】|【条件】|【任职条件】|【资质要求】|任职要求[：:。]?|岗位需求[：:。]?|任职条件[：:。]?)/;
  const rawLines = text.split(/[\n\r]+/).map((s) => s.trim()).filter(Boolean);
  let currentBucket: 'resp' | 'req' = 'resp';
  const responsibilities: string[] = [];
  const requirements: string[] = [];
  let hasMarkers = false;
  for (const line of rawLines) {
    if (RESP_HEADER.test(line)) {
      hasMarkers = true;
      currentBucket = 'resp';
      const content = line.replace(RESP_HEADER, '').trim();
      if (content) responsibilities.push(...splitOnPunct(content));
    } else if (REQ_HEADER.test(line)) {
      hasMarkers = true;
      currentBucket = 'req';
      const content = line.replace(REQ_HEADER, '').trim();
      if (content) requirements.push(...splitOnPunct(content));
    } else {
      const parts = splitOnPunct(line);
      if (currentBucket === 'req') requirements.push(...parts);
      else responsibilities.push(...parts);
    }
  }
  if (!hasMarkers) {
    const lines = rawLines
      .flatMap((s) => s.split(/[；;。]+/))
      .map((s) => s.replace(/^[\d一二三四五六七八九十]+[.、,，\s]+/, '').trim())
      .filter((s) => s.length > 1);
    return { responsibilities: lines, requirements: [] };
  }
  return { responsibilities, requirements };
}

function splitOnPunct(text: string): string[] {
  return text.split(/[；;。]+/)
    .map((s) => s.replace(/^[\d一二三四五六七八九十]+[.、,，\s]+/, '').trim())
    .filter((s) => s.length > 1);
}

// ─── Category detection ───

const CATEGORY_KEYWORDS: [JDCategory, RegExp][] = [
  ['seo', /seo|搜索引擎优化|关键词优化/i],
  ['advertising', /广告|信息流|投放|sem|feed|千川|广告素材|广告策略/i],
  ['gaming', /游戏|unity|unreal|ue[45]|cocos|fps|mmo/i],
  // AI: 匹配独立AI词、AI+中文前缀(AI应用/AI效能/AI产品...)、AIGC、Agent、comfyui
  ['ai', /(^|[\s\-_/｜|（）()【】])ai(?=$|[\s\-_/｜|（）()【】])|ai(?=[^\x00-\x7f])|人工智能|大模型|llm|gpt|prompt|aigc|\bagent\b|comfyui/i],
  ['algorithm', /算法|推荐系统|nlp|机器学习|深度学习|计算机视觉/i],
  ['frontend', /前端|react|vue|h5|小程序|安卓|android|ios|移动端|flutter|客户端|web\s*sdk/i],
  ['backend', /后端|java|\bgo\b|golang|php|ruby|服务端|python|c\+\+|c#|\.net|架构师|架构设计|springcloud/i],
  ['devops', /运维|devops|k8s|kubernetes|docker|ci.*cd|监控/i],
  ['testing', /测试|qa|质量|代码审计/i],
  ['product', /产品经理|产品总监|产品负责人|产品助理|产品调优|产品定价|专案产品|平台产品/i],
  ['design', /ui|ux|设计|视觉|动效/i],
  // 美术: 3D系列、spine、动作设计、角色设计、绑定
  ['art', /美术|原画|概念设计|插画师|3d角色|3d动画|3d战斗|3d建模|建模师|动画师|绑定师|绑定|技术美术|ta(?=\s|$|[_\-/（）【】])|rigging|spine|动作设计|角色设计/i],
  // 市场: 品牌、市场策划/推广/运营、新媒体孵化
  ['marketing', /品牌|市场策划|市场推广|市场营销|市场运营|市场经理|市场总监|kol|公关|新媒体孵化|增长黑客|growth/i],
  // 视频: 加编导
  ['video', /视频|剪辑|后期|短视频|视频制作|导演|摄像|影视|编导|cinemat|videograph/i],
  // 直播: 加团播
  ['live', /直播(?!运营)|主播|场控|中控|带货主播|直播间|直播策划|直播主持|团播/i],
  ['legal', /法务|法律顾问|律师|合规|知识产权|版权|专利/i],
  ['finance', /财务|会计|出纳|审计|税务/i],
  ['data', /数据|数据挖掘|爬虫|etl|数据仓库|数据分析|数据工程|大数据/i],
  ['hardware', /gpu|硬件|芯片|嵌入式|固件|pcb|电路|cpu/i],
  ['hr', /hr|人力|招聘|薪酬|培训|员工关系|组织发展/i],
  ['bd', /商务|bd|拓展|渠道|合作|销售|新客户/i],
  ['customer-service', /客服|客户服务|售后/i],
  ['operations', /运营|电商|直播运营|带货|主播|中控|场控|选品|新媒体运营/i],
  ['project', /项目|pmo|scrum/i],
  // director: 加组长(Java后端组长、新媒体运营组长)
  ['director', /总监|vp|副总裁|cto|ceo|负责人|组长/i],
  // administration: 加督导
  ['administration', /行政|前台|助理|秘书|档案|车辆|办公室|督导/i],
];

function detectCategories(text: string): JDCategory[] {
  const t = text.toLowerCase();
  const result: JDCategory[] = [];
  for (const [cat, re] of CATEGORY_KEYWORDS) {
    if (re.test(t) && !result.includes(cat)) result.push(cat);
  }
  if (result.length === 0) {
    // Broad fallbacks
    if (/开发|程序|码农|软件/i.test(t)) result.push('backend');
    else if (/设计|画|创作|创意/i.test(t)) result.push('design');
    else if (/产品|需求|原型/i.test(t)) result.push('product');
    else if (/数据|报表|指标/i.test(t)) result.push('data');
    else result.push('operations');
  }
  return result.slice(0, 3);
}

function mergeUniqueJDs(existing: JD[], incoming: JD[]): { jds: JD[]; skipped: number } {
  const seen = new Set(existing.map(getJDKey));
  const unique: JD[] = [];

  for (const jd of incoming) {
    const key = getJDKey(jd);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(jd);
  }

  return { jds: [...existing, ...unique], skipped: incoming.length - unique.length };
}

function getJDKey(jd: Pick<JD, 'title' | 'department' | 'location'>): string {
  return [jd.title, jd.department || '', jd.location || '']
    .map((value) => normalizeJDKey(value))
    .join('|');
}

function normalizeJDKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[（(]\s*\d+\s*人\s*[）)]/g, '')
    .replace(/\s+/g, '')
    .replace(/[，,。；;:：|｜\-—_【】[\]()（）]/g, '');
}

function formatExportList(items: string[]): string {
  return items.map((item, index) => `${index + 1}. ${item}`).join('\n');
}

async function exportJDsWithTemplate(jds: JD[]): Promise<void> {
  const ExcelJS = await import('exceljs');
  const res = await fetch('/templates/jd-export-template.xlsx');
  if (!res.ok) {
    alert('导出模板加载失败，请稍后重试。');
    return;
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await res.arrayBuffer());
  const worksheet = workbook.getWorksheet('Sheet1') || workbook.worksheets[0];
  const templateRow = worksheet.getRow(2);
  const templateHeight = templateRow.height;
  const templateStyles = [1, 2, 3, 4, 5].map((col) => ({
    style: { ...templateRow.getCell(col).style },
    alignment: { ...templateRow.getCell(col).alignment, wrapText: true, vertical: 'top' as const },
  }));

  if (worksheet.rowCount > 1) {
    worksheet.spliceRows(2, worksheet.rowCount - 1);
  }

  jds.forEach((jd, index) => {
    const row = worksheet.getRow(index + 2);
    row.values = [
      undefined,
      jd.location || 'remote',
      jd.title,
      formatExportList(jd.responsibilities),
      formatExportList(jd.requirements),
      jd.salaryText || (jd.salaryRange.min ? `${jd.salaryRange.min} - ${jd.salaryRange.max}${jd.salaryRange.currency}` : ''),
    ];
    row.height = templateHeight || 120;
    templateStyles.forEach((item, colIndex) => {
      const cell = row.getCell(colIndex + 1);
      cell.style = item.style;
      cell.alignment = item.alignment;
    });
    row.commit();
  });

  worksheet.columns = [
    { key: 'location', width: 12 },
    { key: 'title', width: 24 },
    { key: 'responsibilities', width: 70 },
    { key: 'requirements', width: 70 },
    { key: 'salary', width: 18 },
  ];

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `JD岗位库_${new Date().toISOString().slice(0, 10)}.xlsx`;
  a.click();
  URL.revokeObjectURL(a.href);
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
