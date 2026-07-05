'use client';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { JDCategoryTabs } from './JDCategoryTabs';
import { JDSearchBar } from './JDSearchBar';
import { JDTable } from './JDTable';
import { JDDetailPanel } from './JDDetailPanel';
import { JDImportDialog } from './JDImportDialog';
import { RecycleBinDialog } from '@/components/common/RecycleBinDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { useJDStore, useFilteredJDs, useCategoryCounts } from '@/store/jd-store';
import { Briefcase, Sparkles, Trash2, X } from 'lucide-react';
import { generateId } from '@/lib/utils';
import type { JDCategory } from '@/types/jd';
import { JD_CATEGORY_LABELS, JD_CATEGORY_COLORS, ALL_CATEGORIES } from '@/types/jd';
import { recentlyAddedJds } from '@/lib/jd-recent';
import { ImportDiffDialog } from './ImportDiffDialog';
import { WeeklyAddedDialog } from './WeeklyAddedDialog';
import { detectCat, parseSalary, parseRawJD } from '@/lib/jd-paste-parse';

export function JDLibraryPage() {
  const [mounted, setMounted] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const [weeklyOpen, setWeeklyOpen] = useState(false);
  const lastImportDiff = useJDStore((s) => s.lastImportDiff);
  const [addOpen, setAddOpen] = useState(false);
  const [batchMode, setBatchMode] = useState(false);
  const [recycleOpen, setRecycleOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // Excel 式列筛选：空集合 = 不筛选
  const [orgFilter, setOrgFilter] = useState<Set<string>>(new Set());
  const [serviceFilter, setServiceFilter] = useState<Set<string>>(new Set());
  const [gapOnly, setGapOnly] = useState(false);
  const [rawJDText, setRawJDText] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');
  const [tgSyncing, setTgSyncing] = useState(false);
  const [addForm, setAddForm] = useState({ title: '', department: '', responsibilities: '', requirements: '', categories: [] as string[], location: 'remote', salary: '' });

  const jds = useJDStore((s) => s.jds);
  const filter = useJDStore((s) => s.filter);
  const selectedJdId = useJDStore((s) => s.selectedJdId);
  const setFilter = useJDStore((s) => s.setFilter);
  const selectJD = useJDStore((s) => s.selectJD);
  const addJdBatch = useJDStore((s) => s.addJdBatch);
  const deleteJD = useJDStore((s) => s.deleteJD);
  const deleteJDBatch = useJDStore((s) => s.deleteJDBatch);
  const cleanAllJDs = useJDStore((s) => s.cleanAllJDs);
  const reclassifyAll = useJDStore((s) => s.reclassifyAll);
  const resetNewBadge = useJDStore((s) => s.resetNewBadge);
  const exportAllJDs = useJDStore((s) => s.exportAllJDs);
  const backupToKV = useJDStore((s) => s.backupToKV);
  const undoDeleteJD = useJDStore((s) => s.undoDeleteJD);
  const lastDeletedJD = useJDStore((s) => s.lastDeletedJD);
  const filteredJDs = useFilteredJDs();
  const categories = useCategoryCounts();

  // 最近 5 个工作日内新增的岗位（按 createdAt，跨周末/跨星期，不在周一被重置）。
  // 「新」角标与「本周新增」面板共用这一份滚动窗口，保证两处完全一致。
  const recentJds = useMemo(() => recentlyAddedJds(jds), [jds]);
  const newJdIds = useMemo(() => new Set(recentJds.map((j) => j.id)), [recentJds]);

  // 列筛选选项：基于全部岗位去重，保证选项不随筛选缩水
  const orgOptions = useMemo(
    () => Array.from(new Set(jds.map((j) => (j.organization || '').trim()))).sort((a, b) => a.localeCompare(b, 'zh-CN')),
    [jds],
  );
  const serviceOptions = useMemo(
    () => Array.from(new Set(jds.map((j) => (j.serviceUnit || j.department || '').trim()))).sort((a, b) => a.localeCompare(b, 'zh-CN')),
    [jds],
  );

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!lastDeletedJD) return;
    const t = setTimeout(() => useJDStore.setState({ lastDeletedJD: null }), 10000);
    return () => clearTimeout(t);
  }, [lastDeletedJD]);

  // 编制组织 / 服务单位 的取值（与表格展示口径一致）
  const orgOf = (j: typeof jds[number]) => (j.organization || '').trim();
  const svcOf = (j: typeof jds[number]) => (j.serviceUnit || j.department || '').trim();

  const finalFiltered = filteredJDs.filter((j) =>
    (orgFilter.size === 0 || orgFilter.has(orgOf(j))) &&
    (serviceFilter.size === 0 || serviceFilter.has(svcOf(j))) &&
    (!gapOnly || (!!j.gap && j.gap !== '0')),
  );
  const selectedJd = jds.find((j) => j.id === selectedJdId) || null;
  const visibleIds = finalFiltered.map((j) => j.id);
  const visibleSelectedCount = selectedIds.filter((id) => visibleIds.includes(id)).length;

  const handleBatchModeChange = (next: boolean) => {
    setBatchMode(next);
    setSelectedIds([]);
    if (next) selectJD(null);
  };

  // useCallback：保持引用稳定，让 memo 化的 JDTable 不因父组件重渲染而整表 reconcile
  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]);
  }, []);

  const handleToggleSelectAll = useCallback(() => {
    setSelectedIds((ids) => {
      const visibleSet = new Set(visibleIds);
      const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => ids.includes(id));
      if (allVisibleSelected) return ids.filter((id) => !visibleSet.has(id));
      return Array.from(new Set([...ids, ...visibleIds]));
    });
  }, [visibleIds]);

  const handleGapOnlyToggle = useCallback(() => setGapOnly((v) => !v), []);

  const handleBatchDelete = () => {
    if (selectedIds.length === 0) return;
    // 批量删除经墓碑机制会同步到全团队且不可撤销，删除前二次确认(展示数量+抽样名单)
    const sample = selectedIds.slice(0, 5)
      .map((id) => jds.find((j) => j.id === id)?.title || id)
      .join('、');
    const more = selectedIds.length > 5 ? ` 等 ${selectedIds.length} 个` : '';
    if (!window.confirm(`确认删除选中的 ${selectedIds.length} 个岗位？\n\n${sample}${more}\n\n此操作会同步到全团队，且无法撤销。`)) return;
    deleteJDBatch(selectedIds);
    setSelectedIds([]);
    setBatchMode(false);
  };

  const handleSync = async () => {
    if (syncing) return;
    setSyncing(true);
    setSyncMsg('同步中…');
    try {
      const res = await fetch('/api/sync/google-run', { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        const parts = [
          data.added ? `新增 ${data.added}` : '',
          data.updated ? `更新 ${data.updated}` : '',
          data.deleted ? `删除 ${data.deleted}` : '',
        ].filter(Boolean);
        setSyncMsg(parts.length ? `同步完成：${parts.join(' · ')}（共 ${data.total}）` : `已是最新（共 ${data.total}）`);
      } else {
        setSyncMsg(`同步失败：${data.error || '未知错误'}`);
      }
    } catch (err) {
      setSyncMsg(`同步失败：${(err as Error).message}`);
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncMsg(''), 8000);
    }
  };

  const handleTgSync = async () => {
    if (tgSyncing) return;
    setTgSyncing(true);
    setSyncMsg('同步 TG 缺口中…');
    try {
      const res = await fetch('/api/sync/tg-run', { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        setSyncMsg(data.updated ? `TG 缺口同步完成：更新 ${data.updated} 个岗位` : 'TG 缺口已是最新');
      } else {
        setSyncMsg(`TG 同步失败：${data.error || '未知错误'}`);
      }
    } catch (err) {
      setSyncMsg(`TG 同步失败：${(err as Error).message}`);
    } finally {
      setTgSyncing(false);
      setTimeout(() => setSyncMsg(''), 8000);
    }
  };

  const handleReclassify = () => {
    if (!window.confirm('将按「标题 + 职责 + 要求」重新判定所有岗位分类，修正历史误分类（如效能官→AI、人事/SSC→HR、签证→行政）。\n\n标题能明确归类的岗位保持不变。是否继续？')) return;
    const { total, changed } = reclassifyAll();
    window.alert(changed > 0 ? `重新分类完成：共 ${total} 个岗位，更新了 ${changed} 个。\n\n如需同步到云端，请点击「备份到云端」。` : `重新分类完成：共 ${total} 个岗位，无需调整。`);
  };

  const handleResetNewBadge = () => {
    if (!window.confirm('将当前整个岗位库标记为「已建立」，清除所有「新」角标。\n\n清除后，只有今后新增（导入面板里全新的岗位）才会显示「新」。是否继续？')) return;
    const { count } = resetNewBadge();
    window.alert(`已清除「新」角标：共处理 ${count} 个岗位。\n\n请点击「备份到云端」同步到其他人。`);
  };

  const handleAdd = () => {
    if (!addForm.title.trim()) return;
    addJdBatch([{
      id: generateId(),
      title: addForm.title.trim(),
      department: addForm.department.trim(),
      categories: addForm.categories.length > 0 ? addForm.categories as JDCategory[] : [detectCat(addForm.title + ' ' + addForm.department)],
      responsibilities: addForm.responsibilities.split(/[；;。\n\r]+/).map((s) => s.trim()).filter(Boolean),
      requirements: addForm.requirements.split(/[；;。\n\r]+/).map((s) => s.trim()).filter(Boolean),
      salaryRange: parseSalary(addForm.salary),
      location: addForm.location.trim() || 'remote',
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }]);
    setAddForm({ title: '', department: '', responsibilities: '', requirements: '', categories: [], location: 'remote', salary: '' });
    setRawJDText('');
    setAddOpen(false);
  };

  const handleRecognizeJD = () => {
    const parsed = parseRawJD(rawJDText);
    if (!parsed.title && !parsed.responsibilities && !parsed.requirements) return;
    setAddForm((form) => ({
      ...form,
      title: parsed.title || form.title,
      department: parsed.department || form.department,
      responsibilities: parsed.responsibilities || form.responsibilities,
      requirements: parsed.requirements || form.requirements,
      categories: parsed.categories.length > 0 ? parsed.categories : form.categories,
      location: parsed.location || form.location,
      salary: parsed.salary || form.salary,
    }));
  };

  // 水合守卫：放在所有 hook 之后，避免条件调用 hook
  if (!mounted) return null;

  return (
    <div className="animate-fade-in space-y-5 max-w-7xl mx-auto">
      <div>
        <h2 className="text-2xl font-bold text-gray-800">JD 岗位库</h2>
        <p className="text-sm text-gray-500 mt-1">
          共 {jds.length} 个岗位，{jds.filter((j) => j.status !== 'paused').length} 个活跃招聘中 ·{' '}
          <button onClick={cleanAllJDs} className="text-indigo-500 hover:text-indigo-600 underline text-xs">清理编号/联系人</button> ·{' '}
          <button onClick={handleReclassify} className="text-purple-500 hover:text-purple-600 underline text-xs">重新分类</button> ·{' '}
          <button onClick={handleResetNewBadge} className="text-sky-500 hover:text-sky-600 underline text-xs">清除新角标</button> ·{' '}
          <button onClick={() => handleBatchModeChange(true)} className="text-red-500 hover:text-red-600 underline text-xs">批量删除</button> ·{' '}
          <button onClick={() => setRecycleOpen(true)} className="text-gray-500 hover:text-gray-700 underline text-xs">回收站</button> ·{' '}
          <button onClick={exportAllJDs} className="text-green-600 hover:text-green-700 underline text-xs">导出 Excel</button> ·{' '}
          <button onClick={backupToKV} className="text-amber-600 hover:text-amber-700 underline text-xs">备份到云端</button> ·{' '}
          <button onClick={handleSync} disabled={syncing} className="text-blue-600 hover:text-blue-700 underline text-xs disabled:opacity-50">{syncing ? '同步中…' : '立即同步源表'}</button> ·{' '}
          <button onClick={handleTgSync} disabled={tgSyncing} className="text-orange-600 hover:text-orange-700 underline text-xs disabled:opacity-50">{tgSyncing ? '同步中…' : '同步 TG 缺口'}</button> ·{' '}
          <button onClick={() => { if (window.confirm(`确定要清空全部 ${jds.length} 个岗位吗？此操作不可撤销。`)) { deleteJDBatch(jds.map((j) => j.id)); } }} className="text-red-600 hover:text-red-700 underline text-xs font-medium">清空全部</button>
        </p>
        {syncMsg && <p className="text-xs text-gray-500 mt-1">{syncMsg}</p>}
      </div>

      <JDCategoryTabs categories={categories} activeCategory={filter.category} onCategoryChange={(cat) => setFilter({ category: cat })} />

      <JDSearchBar
        search={filter.search} onSearchChange={(search) => setFilter({ search })}
        onImportClick={() => setImportOpen(true)} onAddClick={() => setAddOpen(true)}
        batchMode={batchMode} onBatchModeChange={handleBatchModeChange}
        hasDiff={!!lastImportDiff} onDiffClick={() => setDiffOpen(true)}
        weeklyCount={recentJds.length} onWeeklyClick={() => setWeeklyOpen(true)}
      />

      {batchMode && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-red-100 bg-red-50 px-4 py-3">
          <span className="text-sm text-red-700">已选择 {selectedIds.length} 个岗位{visibleSelectedCount !== selectedIds.length ? `，当前列表 ${visibleSelectedCount} 个` : ''}</span>
          <div className="flex items-center gap-2">
            <button onClick={handleToggleSelectAll} className="h-9 px-3 rounded-lg bg-white border border-red-100 text-sm text-red-600 hover:bg-red-50 transition-all">
              {visibleSelectedCount === finalFiltered.length && finalFiltered.length > 0 ? '取消全选' : '全选当前'}
            </button>
            <button onClick={handleBatchDelete} disabled={selectedIds.length === 0} className="h-9 px-3 rounded-lg bg-red-500 text-white text-sm font-medium hover:bg-red-600 disabled:opacity-40 disabled:hover:bg-red-500 transition-all flex items-center gap-2">
              <Trash2 className="w-4 h-4" />删除选中
            </button>
            <button onClick={() => handleBatchModeChange(false)} className="h-9 px-3 rounded-lg bg-white border border-gray-200 text-sm text-gray-500 hover:text-gray-700 transition-all">取消</button>
          </div>
        </div>
      )}

      <GlassPanel padding="none">
        {finalFiltered.length > 0 ? (
          <JDTable
            jds={finalFiltered}
            onSelect={selectJD}
            selectedId={selectedJdId}
            onDelete={deleteJD}
            batchMode={batchMode}
            selectedIds={selectedIds}
            onToggleSelect={handleToggleSelect}
            onToggleSelectAll={handleToggleSelectAll}
            orgOptions={orgOptions}
            serviceOptions={serviceOptions}
            orgFilter={orgFilter}
            serviceFilter={serviceFilter}
            onOrgFilterChange={setOrgFilter}
            onServiceFilterChange={setServiceFilter}
            gapOnly={gapOnly}
            onGapOnlyToggle={handleGapOnlyToggle}
            newJdIds={newJdIds}
          />
        ) : (
          <EmptyState icon={Briefcase} title={jds.length === 0 ? '暂无岗位数据' : '无匹配结果'} description={jds.length === 0 ? '点击"添加岗位"或"批量导入"添加数据' : '尝试调整筛选条件'} />
        )}
      </GlassPanel>

      <JDDetailPanel jd={selectedJd} isOpen={!!selectedJdId} onClose={() => selectJD(null)} />
      <RecycleBinDialog type="jd" open={recycleOpen} onClose={() => setRecycleOpen(false)} />
      <JDImportDialog isOpen={importOpen} onClose={() => setImportOpen(false)} />
      {diffOpen && <ImportDiffDialog diff={lastImportDiff ?? null} onClose={() => setDiffOpen(false)} />}
      {weeklyOpen && <WeeklyAddedDialog recentJds={recentJds} onClose={() => setWeeklyOpen(false)} />}

      {/* Undo delete toast */}
      {lastDeletedJD && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-fade-in">
          <div className="bg-gray-800 text-white rounded-xl shadow-lg px-5 py-3 flex items-center gap-4">
            <span className="text-sm">已删除「{lastDeletedJD.title}」</span>
            <button onClick={() => undoDeleteJD()} className="text-sm font-medium text-indigo-300 hover:text-indigo-200 whitespace-nowrap">撤销</button>
          </div>
        </div>
      )}

      {/* Add JD Dialog */}
      {addOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/20" onClick={() => setAddOpen(false)} />
          <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto bg-white border border-gray-200 rounded-2xl shadow-xl p-6 animate-fade-in">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-800">添加岗位</h3>
              <button onClick={() => setAddOpen(false)} className="p-1.5 rounded-lg hover:bg-gray-100"><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="space-y-3">
              <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-3 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <label className="block text-xs font-medium text-indigo-700">粘贴 JD 内容</label>
                  <button
                    onClick={handleRecognizeJD}
                    disabled={!rawJDText.trim()}
                    className="h-8 px-3 rounded-lg bg-indigo-500 text-white text-xs font-medium hover:bg-indigo-600 disabled:opacity-40 transition-all flex items-center gap-1.5"
                  >
                    <Sparkles className="w-3.5 h-3.5" />一键识别
                  </button>
                </div>
                <textarea
                  value={rawJDText}
                  onChange={(e) => setRawJDText(e.target.value)}
                  placeholder="粘贴完整 JD 文本后点击一键识别"
                  rows={4}
                  className="w-full px-3 py-2 rounded-lg bg-white border border-indigo-100 text-sm focus:outline-none focus:border-indigo-300 resize-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">岗位名称 *</label>
                  <input value={addForm.title} onChange={(e) => setAddForm({ ...addForm, title: e.target.value })}
                    placeholder="如：高级前端工程师" className="w-full h-10 px-4 rounded-xl bg-white border border-gray-200 text-sm focus:outline-none focus:border-indigo-300" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">部门</label>
                  <input value={addForm.department} onChange={(e) => setAddForm({ ...addForm, department: e.target.value })}
                    placeholder="如：技术部" className="w-full h-10 px-4 rounded-xl bg-white border border-gray-200 text-sm focus:outline-none focus:border-indigo-300" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">分类（可多选）</label>
                  <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
                    {(ALL_CATEGORIES as JDCategory[]).slice(0, 11).map((cat) => {
                      const sel = addForm.categories.includes(cat);
                      return (
                        <button key={cat} type="button"
                          onClick={() => setAddForm({ ...addForm, categories: sel ? addForm.categories.filter(c => c !== cat) : [...addForm.categories, cat] })}
                          className={`px-2 py-0.5 rounded-md text-xs font-medium border transition-all ${sel ? JD_CATEGORY_COLORS[cat] : 'bg-white text-gray-400 border-gray-200 hover:border-gray-300'}`}
                        >{JD_CATEGORY_LABELS[cat]}</button>
                      );
                    })}
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {(ALL_CATEGORIES as JDCategory[]).slice(11).map((cat) => {
                      const sel = addForm.categories.includes(cat);
                      return (
                        <button key={cat} type="button"
                          onClick={() => setAddForm({ ...addForm, categories: sel ? addForm.categories.filter(c => c !== cat) : [...addForm.categories, cat] })}
                          className={`px-2 py-0.5 rounded-md text-xs font-medium border transition-all ${sel ? JD_CATEGORY_COLORS[cat] : 'bg-white text-gray-400 border-gray-200 hover:border-gray-300'}`}
                        >{JD_CATEGORY_LABELS[cat]}</button>
                      );
                    })}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">地点</label>
                  <input value={addForm.location} onChange={(e) => setAddForm({ ...addForm, location: e.target.value })}
                    placeholder="remote" className="w-full h-10 px-4 rounded-xl bg-white border border-gray-200 text-sm focus:outline-none focus:border-indigo-300" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">薪资 (如 25K-45K)</label>
                  <input value={addForm.salary} onChange={(e) => setAddForm({ ...addForm, salary: e.target.value })}
                    placeholder="25K-45K" className="w-full h-10 px-4 rounded-xl bg-white border border-gray-200 text-sm focus:outline-none focus:border-indigo-300" />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">岗位职责（换行或分号分隔）</label>
                <textarea value={addForm.responsibilities} onChange={(e) => setAddForm({ ...addForm, responsibilities: e.target.value })}
                  placeholder="负责核心产品前端架构设计；参与组件库建设；优化页面性能" rows={3}
                  className="w-full px-4 py-2 rounded-xl bg-white border border-gray-200 text-sm focus:outline-none focus:border-indigo-300 resize-none" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">岗位要求（换行或分号分隔）</label>
                <textarea value={addForm.requirements} onChange={(e) => setAddForm({ ...addForm, requirements: e.target.value })}
                  placeholder="3年以上前端经验；精通React；熟悉TypeScript" rows={3}
                  className="w-full px-4 py-2 rounded-xl bg-white border border-gray-200 text-sm focus:outline-none focus:border-indigo-300 resize-none" />
              </div>
              <button onClick={handleAdd} className="w-full h-10 rounded-xl bg-indigo-500 text-white text-sm font-medium hover:bg-indigo-600 transition-all">
                确认添加
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
