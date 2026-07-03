import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { JD, JDFilter, JDCategory, JDImportResult, JDDiffItem, JDStatus, WeeklyAdded } from '@/types/jd';
import { hasCategory, parsePriority } from '@/types/jd';
import { JD_CATEGORY_LABELS, JD_STATUS_LABELS, ALL_CATEGORIES } from '@/types/jd';
import { MOCK_JDS } from '@/data/mock-jds';
import { generateId } from '@/lib/utils';
import { parseMultipleJDs, type ParsedJD } from '@/lib/jd-parser';
import { pushImportDiff, pushWeeklyAdded } from '@/lib/sync';
import {
  analyzeColumns,
  classifyJD,
  cleanJDNumbering,
  getJDKey,
  isAllowedTitleHeader,
  mergeUniqueJDs,
  normalizeExcelRows,
  parseSalary,
  rowToColumnJD,
  splitOrgDept,
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
  lastImportDiff: (JDImportResult & { date: string }) | null;
  weeklyAdded: WeeklyAdded | null;
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
  importFromExcel: (file: File, mode?: 'merge' | 'replace') => Promise<JDImportResult>;
  cycleStatus: (id: string) => void;
  cleanAllJDs: () => void;
  reclassifyAll: () => { total: number; changed: number };
  resetNewBadge: () => { count: number };
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
      lastImportDiff: null,
      weeklyAdded: null,
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
        jds: s.jds.map((j) => {
          const cleaned = cleanJDNumbering(j);
          // 修复历史数据中「编制 部门」被塞进同一字段的情况（如「运营中心 领航」→编制运营中心/部门领航）
          const orgSplit = splitOrgDept(cleaned.organization || '');
          const organization = orgSplit.org || cleaned.organization;
          const deptCombined = !cleaned.department || cleaned.department === cleaned.organization;
          const department = orgSplit.dept && deptCombined ? orgSplit.dept : cleaned.department;
          return {
            ...cleaned,
            organization: organization || undefined,
            department,
            responsibilities: stripContactMeta(cleaned.responsibilities),
            requirements: stripContactMeta(cleaned.requirements),
          };
        }),
      })),

      // 用「标题 + 职责 + 要求」综合重判所有岗位分类，修正历史上误落进「运营」兜底的岗位
      // （如「效能官」→AI、「人事主管/SSC」→HR、「签证执行专员」→行政）。
      // 标题能归类的不变，仅当标题无信号时用正文最强信号；返回本次实际改动数量。
      reclassifyAll: () => {
        let changed = 0;
        const jds = get().jds.map((j) => {
          const next = classifyJD(j.title, j.responsibilities, j.requirements);
          const before = [...j.categories].sort().join(',');
          const after = [...next].sort().join(',');
          if (before !== after) {
            changed++;
            return { ...j, categories: next, updatedAt: new Date().toISOString() };
          }
          return j;
        });
        if (changed > 0) set({ jds });
        return { total: jds.length, changed };
      },

      // 把当前岗位库整体标记为「已建立」基线：将所有现有岗位的 createdAt 回拨到 30 天前，
      // 清除因覆盖导入误重置 createdAt 而导致「全部显示新」的状态。
      // 之后只有真正新增（导入时标题/REQ-Key 都匹配不上的岗位）才会显示「新」角标。
      resetNewBadge: () => {
        const baseline = new Date(Date.now() - 30 * 86400000).toISOString();
        const jds = get().jds.map((j) => ({ ...j, createdAt: baseline }));
        set({ jds });
        return { count: jds.length };
      },

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
            const remoteJds = Array.isArray(remote?.jds) ? remote.jds as JD[] : [];
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

      importFromExcel: async (file: File, mode: 'merge' | 'replace' = 'merge') => {
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
          const { titleCol, salaryCol, deptCol, locCol, orgCol, serviceCol, hcCol, vacancyCol, priorityCol, odcCol, requesterCol, notesCol, contentCols } = cols;

          const total = rows.length;
          set({ importProgress: { current: 0, total, percent: 0, status: 'parsing' } });

          const batch: JD[] = [];
          const result: JDImportResult = { success: 0, failed: 0, errors: [] };

          // 仅「无结构化标题列、整段长文本」（如 Google 文档整篇粘贴）才需要 AI 拆分。
          // 面板竖排粘贴 / 规范 Excel 已带岗位名称等列，走确定性列解析即可——
          // 既避免每行一次 DeepSeek 调用导致的数分钟卡顿，也确保对接人(odc)列被写入。
          const rowTexts = rows.map((r) =>
            contentCols.map((c) => String(r[c] || '').trim()).filter(Boolean).join('\n'));
          const needAI = rows.map((r, i) =>
            !String(r[titleCol] || '').trim() && rowTexts[i].length > 200);

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

                if (!ai) {
                  // 确定性列解析：含对接人(odc)，无 AI 调用，速度快
                  const jd = rowToColumnJD(row, cols);
                  if (!jd) { result.failed++; result.errors.push(`第${j + 1}行: 缺少岗位名称（列"${titleCol}"为空）`); continue; }
                  batch.push(jd);
                  result.success++;
                  continue;
                }

                // AI 路径：整段长文本无标题列时由 AI 拆解，仍尽量保留列上的元数据
                // 编制列可能是「运营中心 领航」这类「编制 部门」合并值，按空格拆开。
                const orgSplit = splitOrgDept(orgCol ? String(row[orgCol] || '').trim() : '');
                const organization = orgSplit.org;
                const serviceUnit = serviceCol ? String(row[serviceCol] || '').trim() : '';
                const headcount = hcCol ? String(row[hcCol] || '').trim() : '';
                const gap = (vacancyCol ? String(row[vacancyCol] || '').trim() : '') || '0';
                const priority = priorityCol ? parsePriority(String(row[priorityCol] || '').trim()) : undefined;
                const odc = odcCol ? String(row[odcCol] || '').trim() : '';
                const requester = requesterCol ? String(row[requesterCol] || '').trim() : '';
                const notes = notesCol ? String(row[notesCol] || '').trim() : '';
                const reqKey = cols.reqKeyCol ? String(row[cols.reqKeyCol] || '').trim() : '';
                const expedited = cols.expeditedCol ? !!String(row[cols.expeditedCol] || '').trim() : false;

                const title = rawTitleCell || (ai.title || '').trim();
                if (!title) { result.failed++; result.errors.push(`第${j + 1}行: 缺少岗位名称`); continue; }
                const department = (deptCol ? String(row[deptCol] || '').trim() : '') || orgSplit.dept || serviceUnit || ai.department || organization;
                const rawSalary = salaryCol ? String(row[salaryCol] || '').trim() : ai.salary || '';
                const location = ai.location || (locCol ? String(row[locCol] || '').trim() : 'remote');
                const responsibilities = Array.isArray(ai.responsibilities) ? ai.responsibilities : [];
                const requirements = Array.isArray(ai.requirements) ? ai.requirements : [];

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
                  odc: odc || undefined,
                  requester: requester || undefined,
                  reqKey: reqKey || undefined,
                  expedited: expedited || undefined,
                  notes: notes || undefined,
                  categories: classifyJD(title, responsibilities, requirements),
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

          // 导入后统一清理一遍职责/要求里的序号前缀（1. 一、 ① 等），无论合并还是覆盖。
          const cleanBatch = batch.map(cleanJDNumbering);

          if (mode === 'replace' && cleanBatch.length === 0) {
            // 安全保护：覆盖模式下解析为 0 条时绝不清空岗位库（避免误粘空内容把库清空）。
            set({ isImporting: false, importProgress: { current: 0, total: 0, percent: 100, status: 'done' } });
            return { success: 0, failed: 0, errors: ['未解析到任何岗位，已取消覆盖（岗位库保持不变）'] };
          }
          if (mode === 'replace') {
            // 全量覆盖：用本次粘贴替换整个岗位库（先对本批内部去重，避免同一面板里重复 REQ-Key）。
            // 一次粘贴 = 新增 + 更新 + 删除：面板里没有的岗位会随覆盖一并移除。
            const deduped = mergeUniqueJDs([], cleanBatch);
            // 每日面板只有摘要列（岗位名/薪资/部门/编制），没有职责/要求。
            // 覆盖时若新行缺职责/要求，则沿用库中同一岗位的旧内容，避免覆盖把 JD 详情清空。
            const oldByKey = new Map(get().jds.map((j) => [getJDKey(j), j]));
            // 标题兜底：REQ-Key 变化时仍能认出同一岗位，避免覆盖导入把 createdAt 重置成 now
            // （否则整库每次覆盖都会「全部显示新」）。仅在精确 key 匹配不到时启用。
            const normReclassTitle = (t: string) =>
              t.toLowerCase().replace(/[（(]\s*\d+\s*人\s*[）)]/g, '').replace(/\s+/g, '');
            const oldByTitle = new Map(get().jds.map((j) => [normReclassTitle(j.title), j] as const));
            const enriched = deduped.jds.map((jd) => {
              const old = oldByKey.get(getJDKey(jd)) || oldByTitle.get(normReclassTitle(jd.title));
              const hasResp = jd.responsibilities && jd.responsibilities.length > 0;
              const hasReq = jd.requirements && jd.requirements.length > 0;
              // 补全正文：日报面板常只有摘要列，缺职责/要求时沿用库中同岗位旧内容
              const responsibilities = hasResp ? jd.responsibilities : (old?.responsibilities ?? jd.responsibilities);
              const requirements = hasReq ? jd.requirements : (old?.requirements ?? jd.requirements);
              // 自动重新分类：用「补全后的完整正文 + 标题」重判分类，根治仅靠摘要标题误分类
              const categories = classifyJD(jd.title, responsibilities, requirements);
              // 命中已有岗位：保留原始 createdAt（即使只改了 HC/缺口等也不算「新」）；
              // 真正新增（标题/REQ-Key 都匹配不到）：保留 createdAt = now，5 工作日内显示「新」。
              const createdAt = old ? old.createdAt : jd.createdAt;
              return { ...jd, createdAt, responsibilities, requirements, categories };
            });
            // 计算新增 / 移除 / 异动 diff（在写入前用旧数据对比）
            const prevJds = get().jds;
            const newByKey = new Map(enriched.map((j) => [getJDKey(j), j]));

            result.added = enriched
              .filter((j) => !oldByKey.has(getJDKey(j)))
              .map((j) => ({ title: j.title, reqKey: j.reqKey, organization: j.organization, department: j.department, serviceUnit: j.serviceUnit }));

            result.removed = prevJds
              .filter((j) => !newByKey.has(getJDKey(j)))
              .map((j) => ({ title: j.title, reqKey: j.reqKey, organization: j.organization, department: j.department, serviceUnit: j.serviceUnit }));

            result.changed = enriched
              .filter((j) => oldByKey.has(getJDKey(j)))
              .reduce<JDDiffItem[]>((acc, j) => {
                const old = oldByKey.get(getJDKey(j))!;
                const diffs: string[] = [];
                if (old.status !== j.status) diffs.push(`状态 ${JD_STATUS_LABELS[old.status]}→${JD_STATUS_LABELS[j.status]}`);
                if ((old.headcount ?? '') !== (j.headcount ?? '')) diffs.push(`HC ${old.headcount || '-'}→${j.headcount || '-'}`);
                if ((old.gap ?? '') !== (j.gap ?? '')) diffs.push(`缺口 ${old.gap || '-'}→${j.gap || '-'}`);
                if ((old.priority ?? '') !== (j.priority ?? '')) diffs.push(`优先级 ${old.priority || '-'}→${j.priority || '-'}`);
                if ((old.odc ?? '') !== (j.odc ?? '')) diffs.push(`对接人`);
                if ((old.notes ?? '') !== (j.notes ?? '')) diffs.push(`备注`);
                if (diffs.length) acc.push({ title: j.title, reqKey: j.reqKey, organization: j.organization, department: j.department, serviceUnit: j.serviceUnit, changes: diffs });
                return acc;
              }, []);

            useJDStore.setState({ jds: enriched });
            result.success = enriched.length;
            result.failed = 0;
            result.errors = [];
            result.replaced = enriched.length;
            if (deduped.skipped > 0) result.errors.push(`本次粘贴内有 ${deduped.skipped} 条重复 REQ-Key，已合并`);
            // 持久化今日增改，供工具栏"今日增改"按钮调取；同时推送到 KV 供其他用户查看
            const importDiff = { ...result, date: new Date().toISOString() };
            // 累计本周新增：新 diff.added 追加到本周列表（按周一日期重置）
            const weekKey = getMondayKey();
            const prev = get().weeklyAdded;
            const baseItems = prev?.weekKey === weekKey ? prev.items : [];
            const newItems = result.added ?? [];
            const existingKeys = new Set(baseItems.map((i) => i.reqKey || i.title));
            const toAdd = newItems.filter((i) => !existingKeys.has(i.reqKey || i.title));
            const updatedWeekly: WeeklyAdded = {
              weekKey,
              items: [...baseItems, ...toAdd],
              lastUpdated: new Date().toISOString(),
            };
            set({ lastImportDiff: importDiff, weeklyAdded: updatedWeekly });
            pushImportDiff(importDiff).catch(() => {});
            pushWeeklyAdded(updatedWeekly).catch(() => {});
          } else {
            // 每日面板新行常缺职责/要求。合并前先从库中同岗位回填内容，
            // 否则「岗位身份变了（旧无 REQ-Key、新有 REQ-Key）」时会新增一条空壳 JD。
            // 双重匹配：先按 getJDKey（含 REQ-Key），再按标题兜底。
            const existing = get().jds;
            const oldByKey = new Map(existing.map((j) => [getJDKey(j), j]));
            const normTitle = (t: string) => t.toLowerCase().replace(/[（(]\s*\d+\s*人\s*[）)]/g, '').replace(/\s+/g, '');
            const oldByTitle = new Map(
              existing
                .filter((j) => (j.responsibilities?.length || 0) > 0 || (j.requirements?.length || 0) > 0)
                .map((j) => [normTitle(j.title), j])
            );
            const enrichedBatch = cleanBatch.map((jd) => {
              const hasResp = (jd.responsibilities?.length || 0) > 0;
              const hasReq = (jd.requirements?.length || 0) > 0;
              if (hasResp && hasReq) return jd;
              const old = oldByKey.get(getJDKey(jd)) || oldByTitle.get(normTitle(jd.title));
              if (!old) return jd;
              return {
                ...jd,
                responsibilities: hasResp ? jd.responsibilities : old.responsibilities,
                requirements: hasReq ? jd.requirements : old.requirements,
              };
            });
            // 增量合并：跳过岗位库里已存在的岗位（按 REQ-Key 查重），只新增没有的。
            const merged = mergeUniqueJDs(existing, enrichedBatch);
            useJDStore.setState({ jds: merged.jds });
            if (merged.skipped > 0) {
              result.success -= merged.skipped;
              result.skipped = merged.skipped;
              result.errors.push(`已自动跳过 ${merged.skipped} 条已存在岗位（库中已有，非错误）`);
            }
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
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // 若 weeklyAdded 为空但 lastImportDiff 有数据，则自动补充（首次部署兼容）
        if (!state.weeklyAdded && state.lastImportDiff?.added?.length && state.lastImportDiff.date) {
          const d = new Date(state.lastImportDiff.date);
          const day = d.getDay();
          const mon = new Date(d);
          mon.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
          const weekKey = `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, '0')}-${String(mon.getDate()).padStart(2, '0')}`;
          const weekly: WeeklyAdded = { weekKey, items: state.lastImportDiff.added, lastUpdated: state.lastImportDiff.date };
          state.weeklyAdded = weekly;
          // 异步写入 KV，让其他端也能拿到
          pushWeeklyAdded(weekly).catch(() => {});
        }
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

/** 返回本周周一的日期字符串，如 "2026-06-22"，用作本周新增的 weekKey */
function getMondayKey(): string {
  const now = new Date();
  const day = now.getDay(); // 0=Sun
  const diffToMon = day === 0 ? -6 : 1 - day;
  const mon = new Date(now);
  mon.setDate(now.getDate() + diffToMon);
  return `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, '0')}-${String(mon.getDate()).padStart(2, '0')}`;
}

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
  { header: '简历对接人', key: 'odc', width: 18 },
  { header: '需求发起人', key: 'requester', width: 18 },
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
    requester: jd.requester || '',
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

export function useCategoryCounts(): { id: JDCategory | 'all'; label: string; count: number }[] {
  const { jds } = useJDStore();
  const entries: { id: JDCategory | 'all'; label: string; count: number }[] = [{ id: 'all', label: '全部', count: jds.length }];
  // 用权威的 ALL_CATEGORIES，确保新增分类（市场/美术/视频/直播/法务/培训/内容）也出现在标签栏
  for (const cat of ALL_CATEGORIES) {
    entries.push({ id: cat, label: JD_CATEGORY_LABELS[cat], count: jds.filter((j) => hasCategory(j, cat)).length });
  }
  return entries;
}
