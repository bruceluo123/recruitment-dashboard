'use client';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { JDCategoryTabs } from './JDCategoryTabs';
import { JDSearchBar } from './JDSearchBar';
import { JDTable } from './JDTable';
import { JDDetailPanel } from './JDDetailPanel';
import { JDImportDialog } from './JDImportDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { useJDStore, useFilteredJDs, useCategoryCounts } from '@/store/jd-store';
import { Briefcase, Sparkles, Trash2, X, Bell, Megaphone, Copy, Check } from 'lucide-react';
import { generateId } from '@/lib/utils';
import type { JDCategory, JDImportResult, JDDiffItem, JD } from '@/types/jd';
import { JD_CATEGORY_LABELS, JD_CATEGORY_COLORS, ALL_CATEGORIES } from '@/types/jd';
import { buildAdCopy, buildDesensitizedCopy, adVariantLabel, type AdVariant, type AdSegment } from '@/lib/ad-copy';
import { recentlyAddedJds, recentWindowLabel } from '@/lib/jd-recent';

export function JDLibraryPage() {
  const [mounted, setMounted] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const [weeklyOpen, setWeeklyOpen] = useState(false);
  const lastImportDiff = useJDStore((s) => s.lastImportDiff);
  const [addOpen, setAddOpen] = useState(false);
  const [batchMode, setBatchMode] = useState(false);
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

const CAT_MAP: [JDCategory, RegExp][] = [
  ['seo', /seo|搜索引擎|关键词/i], ['advertising', /广告|信息流|投放|sem|feed|千川/i],
  ['gaming', /游戏|unity|unreal|ue[45]|cocos/i], ['ai', /人工智能|大模型|llm|gpt|prompt/i],
  ['algorithm', /算法|推荐|nlp|机器学习|深度学习|计算机视觉/i], ['frontend', /前端|web|react|vue|h5|小程序|安卓|android|ios|移动端|flutter|客户端/i],
  ['backend', /后端|java|go|golang|php|ruby|服务端|python|c\+\+|c#|架构师|开发/i], ['devops', /运维|devops|k8s|kubernetes|docker|ci.*cd|监控/i],
  ['testing', /测试|qa|质量/i], ['product', /产品经理|产品总监|产品助理/i], ['design', /ui|ux|设计|视觉|插画|动效/i],
  ['finance', /财务|会计|出纳|审计|税务/i], ['hr', /hr|人力|招聘|薪酬|培训|员工关系/i],
  ['bd', /商务|bd|拓展|渠道|合作|销售/i], ['customer-service', /客服|客户服务|售后/i],
  ['operations', /运营|电商|直播|带货|主播|中控|场控|选品/i], ['project', /项目|pmo|scrum/i],
  ['director', /总监|vp|副总裁|cto|ceo|负责人/i], ['administration', /行政|前台|助理|秘书|档案|车辆|办公室/i],
  ['data', /数据挖掘|数据工程|爬虫|etl|数仓|数据/i], ['hardware', /gpu|硬件|芯片|嵌入式|固件/i],
];

function detectCat(text: string): JDCategory {
  const t = text.toLowerCase();
  for (const [cat, re] of CAT_MAP) { if (re.test(t)) return cat; }
  return 'operations';
}

function detectCats(text: string): JDCategory[] {
  const t = text.toLowerCase();
  const cats: JDCategory[] = [];
  for (const [cat, re] of CAT_MAP) {
    if (re.test(t) && !cats.includes(cat)) cats.push(cat);
  }
  return cats.length > 0 ? cats.slice(0, 3) : ['operations'];
}

function parseRawJD(raw: string): {
  title: string;
  department: string;
  salary: string;
  location: string;
  responsibilities: string;
  requirements: string;
  categories: string[];
} {
  const text = raw.replace(/\r/g, '').trim();
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const titleLine = pickField(text, /(?:职位名称|岗位名称)[:：]\s*([^\n]+)/i) ||
    lines.find((line) => !/薪资|办公地点|工作地点|岗位亮点|岗位职责|工作内容|任职要求|岗位要求|职位要求|加分项/.test(line)) || '';
  const title = cleanupTitle(titleLine);
  const department = pickField(text, /(?:部门|所属部门|渠道|团队)[:：]\s*([^\n]+)/i);
  const salary = pickField(text, /(?:薪资待遇|薪资|月薪|薪酬)[:：]\s*([^\n]+)/i);
  const location = pickField(text, /(?:办公地点|工作地点|地点)[:：]\s*([^\n]+)/i);
  const responsibilities = extractSection(text, ['岗位职责', '工作职责', '工作内容', '职位职责'], ['任职要求', '岗位要求', '职位要求', '加分项']);
  const requirements = [
    extractSection(text, ['任职要求', '岗位要求', '职位要求'], ['加分项', '岗位职责', '工作职责', '工作内容']),
    extractSection(text, ['加分项'], []),
  ].filter(Boolean).join('\n');
  const categories = detectCats([title, responsibilities, requirements].join(' '));

  return { title, department, salary, location, responsibilities, requirements, categories };
}

function cleanupTitle(line: string): string {
  return line
    .replace(/^【[^】]+】\s*/, '')
    .replace(/[（(]\s*\d+\s*人\s*[）)]/g, '')
    .replace(/^\s*急聘\s*[|｜-]?\s*/i, '')
    .trim();
}

function pickField(text: string, re: RegExp): string {
  return text.match(re)?.[1]?.trim() || '';
}

function extractSection(text: string, startKeys: string[], endKeys: string[]): string {
  const startPattern = startKeys.join('|');
  const endPattern = endKeys.length > 0 ? endKeys.join('|') : '$';
  const re = new RegExp(`(?:^|\\n)(?:${startPattern})\\s*[:：]?\\s*\\n?([\\s\\S]*?)(?=\\n\\s*(?:${endPattern})\\s*[:：]?\\s*(?:\\n|$)|$)`);
  const content = text.match(re)?.[1]?.trim() || '';
  return content
    .split('\n')
    .map((line) => line.replace(/^[\d]+[.、]\s*/, '').replace(/^[-•·]\s*/, '').trim())
    .filter(Boolean)
    .join('\n');
}

// ─── ImportDiffDialog ──────────────────────────────────────────────────────────

function ImportDiffDialog({ diff, onClose }: { diff: (JDImportResult & { date: string }) | null; onClose: () => void }) {
  const jds = useJDStore((s) => s.jds);
  const [previewJd, setPreviewJd] = useState<JD | null>(null);

  const dateLabel = diff ? (() => {
    const d = new Date(diff.date);
    return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  })() : null;

  const findJd = (item: JDDiffItem): JD | undefined => {
    if (item.reqKey) {
      const byKey = jds.find((j) => j.reqKey === item.reqKey);
      if (byKey) return byKey;
    }
    return jds.find((j) => j.title.trim() === item.title.trim());
  };

  const handleItemClick = (item: JDDiffItem) => {
    const found = findJd(item);
    if (!found) return;
    setPreviewJd((prev) => (prev?.id === found.id ? null : found));
  };

  const renderDiffItem = (item: JDDiffItem, color: string, clickable: boolean) => {
    // 优先读当前库中该岗位的实时字段，让历史 diff 快照也与详情卡保持一致（服务单位）；
    // 找不到（如已移除岗位）时退回 diff 自身记录的字段。
    const live = findJd(item);
    const org = live?.organization ?? item.organization;
    const svc = live?.serviceUnit ?? item.serviceUnit ?? live?.department ?? item.department;
    return (
      <li
        key={item.reqKey || item.title}
        onClick={clickable ? () => handleItemClick(item) : undefined}
        className={clickable ? 'text-xs text-gray-700 flex items-baseline gap-1.5 cursor-pointer rounded-md px-1 py-0.5 -mx-1 hover:bg-gray-50 transition-colors' + (previewJd && live?.id === previewJd.id ? ' bg-indigo-50' : '') : 'text-xs text-gray-700 flex items-baseline gap-1.5'}
      >
        <span className={`shrink-0 ${color}`}>·</span>
        <span className={clickable ? 'hover:text-indigo-600 transition-colors' : ''}>{item.title}</span>
        {(org || svc) && (
          <span className="text-gray-400 shrink-0">
            {[org, svc].filter(Boolean).join(' · ')}
          </span>
        )}
        {item.changes && item.changes.length > 0 && (
          <span className="text-amber-600 ml-1 shrink-0">— {item.changes.join('，')}</span>
        )}
      </li>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="fixed inset-0 bg-black/20" onClick={onClose} />

      {/* JD detail preview panel (left of diff panel) */}
      {previewJd && (
        <div className="relative z-10 w-[360px] h-full bg-white border-r border-gray-100 shadow-xl flex flex-col overflow-hidden animate-fade-in">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className={`px-2 py-0.5 rounded-md text-xs font-medium shrink-0 ${JD_CATEGORY_COLORS[previewJd.categories[0]]}`}>
                {JD_CATEGORY_LABELS[previewJd.categories[0]]}
              </span>
              <h4 className="text-sm font-semibold text-gray-800 truncate">{previewJd.title}</h4>
            </div>
            <button onClick={() => setPreviewJd(null)} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 shrink-0 ml-2">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="overflow-y-auto flex-1 px-4 py-3 space-y-4">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
              {previewJd.organization && <span>🏢 {previewJd.organization}</span>}
              {(previewJd.serviceUnit || previewJd.department) && <span>📍 {previewJd.serviceUnit || previewJd.department}</span>}
              {previewJd.headcount && <span>HC: <span className="font-medium text-gray-700">{previewJd.headcount}</span></span>}
              {previewJd.gap && previewJd.gap !== '0' && <span className="text-red-500 font-medium">缺口: {previewJd.gap}</span>}
              {(previewJd.salaryText || (previewJd.salaryRange.min > 0)) && (
                <span className="text-green-600 font-medium">
                  {previewJd.salaryText || `${previewJd.salaryRange.min}K-${previewJd.salaryRange.max}K`}
                </span>
              )}
            </div>
            {previewJd.responsibilities.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">岗位职责</p>
                <ul className="space-y-1">
                  {previewJd.responsibilities.map((r, i) => (
                    <li key={i} className="text-xs text-gray-600 flex gap-1.5 leading-relaxed">
                      <span className="text-gray-300 shrink-0 mt-0.5">·</span><span>{r}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {previewJd.requirements.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">岗位要求</p>
                <ul className="space-y-1">
                  {previewJd.requirements.map((r, i) => (
                    <li key={i} className="text-xs text-gray-600 flex gap-1.5 leading-relaxed">
                      <span className="text-gray-300 shrink-0 mt-0.5">·</span><span>{r}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {previewJd.notes && (
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">备注说明</p>
                <p className="text-xs text-gray-600 leading-relaxed whitespace-pre-line">{previewJd.notes}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Diff panel (right) */}
      <div
        className="relative z-10 w-[300px] h-full bg-white shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <h3 className="text-base font-semibold text-gray-800 flex items-center gap-2">
            <Bell className="w-4 h-4 text-indigo-500" />今日增改{dateLabel ? ` · ${dateLabel}` : ''}
          </h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400"><X className="w-5 h-5" /></button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-5 text-sm">
          {!diff ? (
            <div className="py-8 text-center">
              <p className="text-gray-500 text-sm">暂无增改记录</p>
              <p className="text-gray-400 text-xs mt-1">下次批量导入时开启「覆盖模式」，完成后此处将自动保存完整增改明细。</p>
            </div>
          ) : (<>
          <p className="text-gray-500 text-xs">
            已覆盖：岗位库现为 <span className="font-semibold text-gray-800">{diff.replaced}</span> 个岗位
          </p>

          {diff.added && diff.added.length > 0 && (
            <div>
              <p className="font-semibold text-green-700 mb-2">🟢 新增 {diff.added.length} 个岗位</p>
              <ul className="space-y-0.5 pl-1">
                {diff.added.map((d) => renderDiffItem(d, 'text-green-500', true))}
              </ul>
            </div>
          )}

          {diff.removed && diff.removed.length > 0 && (
            <div>
              <p className="font-semibold text-red-600 mb-2">🔴 移除 {diff.removed.length} 个岗位</p>
              <ul className="space-y-0.5 pl-1">
                {diff.removed.map((d) => renderDiffItem(d, 'text-red-400', false))}
              </ul>
            </div>
          )}

          {diff.changed && diff.changed.length > 0 && (
            <div>
              <p className="font-semibold text-amber-600 mb-2">🟡 异动 {diff.changed.length} 个岗位</p>
              <ul className="space-y-0.5 pl-1">
                {diff.changed.map((d) => renderDiffItem(d, 'text-amber-500', true))}
              </ul>
            </div>
          )}

          {!diff.added?.length && !diff.removed?.length && !diff.changed?.length && (
            <p className="text-gray-400 text-center py-4">本次覆盖与上次相比无变化。</p>
          )}
          </>)}
        </div>
      </div>
    </div>
  );
}

// ─── WeeklyAddedDialog ──────────────────────────────────────────────────────────

function WeeklyAddedDialog({ recentJds, onClose }: { recentJds: JD[]; onClose: () => void }) {
  const [previewJd, setPreviewJd] = useState<JD | null>(null);
  const [copyMode, setCopyMode] = useState(false);
  const [copyVariant, setCopyVariant] = useState<AdVariant>('maimanfen');
  const [copyHideSalary, setCopyHideSalary] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  // 文案模式下被排除的岗位（不想发的）。排除后文案会自动从 1 重新编号
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set());

  const weekLabel = recentWindowLabel();

  const handleItemClick = (jd: JD) => {
    setPreviewJd((prev) => (prev?.id === jd.id ? null : jd));
  };

  const toggleExclude = (id: string) => {
    setExcludedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // 滚动窗口内的岗位即「本周新增」，直接用于文案生成（最近的排在前面）
  const weeklyJds = useMemo<JD[]>(
    () => [...recentJds].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')),
    [recentJds],
  );

  // 实际进入文案的岗位 = 本周新增 − 被排除的
  const selectedJds = useMemo<JD[]>(
    () => weeklyJds.filter((jd) => !excludedIds.has(jd.id)),
    [weeklyJds, excludedIds],
  );

  // 文案不再自动生成：用户删完不想发的岗位后，手动点「生成文案」才出结果并从 1 重新编号
  const [generatedSegments, setGeneratedSegments] = useState<AdSegment[]>([]);
  const [generatedSig, setGeneratedSig] = useState('');

  // 当前选择的签名（岗位集合 + 风格 + 脱敏），用于判断生成结果是否已过期
  const currentSig = useMemo(
    () => `${copyHideSalary ? 'd' : 'n'}|${copyVariant}|${selectedJds.map((jd) => jd.id).join(',')}`,
    [copyHideSalary, copyVariant, selectedJds],
  );
  const isDirty = generatedSig !== currentSig;

  const buildSegments = (): AdSegment[] => {
    if (!selectedJds.length) return [];
    if (copyHideSalary) return [buildDesensitizedCopy(selectedJds)];
    return buildAdCopy(selectedJds, '本周新增', copyVariant, 22);
  };

  const handleGenerate = () => {
    setGeneratedSegments(buildSegments());
    setGeneratedSig(currentSig);
  };

  const openCopyMode = () => {
    setPreviewJd(null);
    setCopyMode((on) => {
      const next = !on;
      // 进入文案模式时按当前（全部）岗位先生成一版，用户再删减后点「重新生成」
      if (next) {
        const segs = selectedJds.length
          ? (copyHideSalary ? [buildDesensitizedCopy(selectedJds)] : buildAdCopy(selectedJds, '本周新增', copyVariant, 22))
          : [];
        setGeneratedSegments(segs);
        setGeneratedSig(currentSig);
      }
      return next;
    });
  };

  const handleCopy = (text: string, idx: number) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedIdx(idx);
      setTimeout(() => setCopiedIdx(null), 1500);
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="fixed inset-0 bg-black/20" onClick={onClose} />

      {/* JD detail preview panel (left of weekly panel) */}
      {previewJd && !copyMode && (
        <div className="relative z-10 w-[360px] h-full bg-white border-r border-gray-100 shadow-xl flex flex-col overflow-hidden animate-fade-in">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className={`px-2 py-0.5 rounded-md text-xs font-medium shrink-0 ${JD_CATEGORY_COLORS[previewJd.categories[0]]}`}>
                {JD_CATEGORY_LABELS[previewJd.categories[0]]}
              </span>
              <h4 className="text-sm font-semibold text-gray-800 truncate">{previewJd.title}</h4>
            </div>
            <button onClick={() => setPreviewJd(null)} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 shrink-0 ml-2">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="overflow-y-auto flex-1 px-4 py-3 space-y-4">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
              {previewJd.organization && <span>🏢 {previewJd.organization}</span>}
              {(previewJd.serviceUnit || previewJd.department) && <span>📍 {previewJd.serviceUnit || previewJd.department}</span>}
              {previewJd.headcount && <span>HC: <span className="font-medium text-gray-700">{previewJd.headcount}</span></span>}
              {previewJd.gap && previewJd.gap !== '0' && <span className="text-red-500 font-medium">缺口: {previewJd.gap}</span>}
              {(previewJd.salaryText || (previewJd.salaryRange.min > 0)) && (
                <span className="text-green-600 font-medium">
                  {previewJd.salaryText || `${previewJd.salaryRange.min}K-${previewJd.salaryRange.max}K`}
                </span>
              )}
            </div>
            {previewJd.responsibilities.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">岗位职责</p>
                <ul className="space-y-1">
                  {previewJd.responsibilities.map((r, i) => (
                    <li key={i} className="text-xs text-gray-600 flex gap-1.5 leading-relaxed">
                      <span className="text-gray-300 shrink-0 mt-0.5">·</span><span>{r}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {previewJd.requirements.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">岗位要求</p>
                <ul className="space-y-1">
                  {previewJd.requirements.map((r, i) => (
                    <li key={i} className="text-xs text-gray-600 flex gap-1.5 leading-relaxed">
                      <span className="text-gray-300 shrink-0 mt-0.5">·</span><span>{r}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {previewJd.notes && (
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">备注说明</p>
                <p className="text-xs text-gray-600 leading-relaxed whitespace-pre-line">{previewJd.notes}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 招聘文案 panel (left of weekly panel, when copyMode) */}
      {copyMode && (
        <div className="relative z-10 w-[400px] h-full bg-white border-r border-gray-100 shadow-xl flex flex-col overflow-hidden animate-fade-in">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 shrink-0">
            <h4 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
              <Megaphone className="w-4 h-4 text-red-500" />
              招聘文案 · 已选 {selectedJds.length} 个岗位{excludedIds.size > 0 ? `（排除 ${excludedIds.size}）` : ''}
            </h4>
            <button onClick={() => setCopyMode(false)} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 shrink-0">
              <X className="w-4 h-4" />
            </button>
          </div>
          {/* 风格 + 脱敏切换 */}
          <div className="flex gap-2 px-4 py-2.5 border-b border-gray-100 shrink-0 flex-wrap">
            <button
              onClick={() => setCopyHideSalary(false)}
              className={`px-3 h-7 rounded-lg text-xs font-medium transition-all ${!copyHideSalary ? 'bg-gray-700 text-white' : 'border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
            >常规</button>
            <button
              onClick={() => setCopyHideSalary(true)}
              className={`px-3 h-7 rounded-lg text-xs font-medium transition-all ${copyHideSalary ? 'bg-gray-700 text-white' : 'border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
            >脱敏</button>
            {/* 脱敏模式下隐藏风格按钮（模板固定） */}
            {!copyHideSalary && (
              <>
                <div className="w-px self-stretch bg-gray-200 mx-0.5" />
                {(['maimanfen', 'tieniu'] as AdVariant[]).map((v) => (
                  <button
                    key={v}
                    onClick={() => setCopyVariant(v)}
                    className={`px-3 h-7 rounded-lg text-xs font-medium transition-all ${
                      copyVariant === v
                        ? 'bg-red-500 text-white'
                        : 'border border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {adVariantLabel(v)}版
                  </button>
                ))}
              </>
            )}
            <span className="ml-auto text-xs text-gray-400 self-center">
              {selectedJds.length} 个岗位 · {generatedSegments.length} 段
            </span>
          </div>
          <p className="px-4 pt-2.5 text-[11px] text-gray-400 shrink-0">删掉不想发的岗位后点「生成文案」，会自动从 1 重新编号。</p>
          <div className="overflow-y-auto flex-1 px-4 py-3 space-y-3">
            {/* 岗位清单：可逐条删除 */}
            {selectedJds.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-8">{weeklyJds.length === 0 ? '本周暂无可生成文案的岗位' : '已全部删除，点右侧列表可恢复'}</p>
            ) : (
              <div className="rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-600">
                  岗位清单 · {selectedJds.length} 个（删完点生成）
                </div>
                <ul className="divide-y divide-gray-100 max-h-[40vh] overflow-y-auto">
                  {selectedJds.map((jd, i) => (
                    <li key={jd.id} className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-700">
                      <span className="shrink-0 w-5 text-gray-400 tabular-nums">{i + 1}</span>
                      <span className="flex-1 min-w-0 truncate">{jd.title}</span>
                      {(jd.organization || jd.department) && (
                        <span className="text-gray-400 shrink-0 truncate max-w-[100px]">{[jd.organization, jd.department].filter(Boolean).join(' · ')}</span>
                      )}
                      <button
                        onClick={() => toggleExclude(jd.id)}
                        title="从文案中删除该岗位"
                        className="shrink-0 p-1 rounded-md text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* 生成按钮：有改动时高亮提示重新生成 */}
            <button
              onClick={handleGenerate}
              disabled={selectedJds.length === 0}
              className={`w-full flex items-center justify-center gap-1.5 h-9 rounded-xl text-sm font-medium transition-all ${
                selectedJds.length === 0
                  ? 'bg-gray-100 text-gray-300 cursor-not-allowed'
                  : isDirty
                    ? 'bg-red-500 text-white hover:bg-red-600'
                    : 'border border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              <Sparkles className="w-4 h-4" />
              {generatedSegments.length === 0 ? '生成文案' : isDirty ? '重新生成（已改动）' : '已是最新'}
            </button>

            {/* 生成结果 */}
            {generatedSegments.map((seg, idx) => (
              <div key={idx} className="rounded-xl border border-gray-200 overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-200">
                  <span className="text-xs font-semibold text-gray-600">{seg.title}</span>
                  <button
                    onClick={() => handleCopy(seg.text, idx)}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium transition-all border border-gray-200 bg-white hover:bg-gray-50 text-gray-600"
                  >
                    {copiedIdx === idx
                      ? <><Check className="w-3 h-3 text-green-500" />已复制</>
                      : <><Copy className="w-3 h-3" />复制</>
                    }
                  </button>
                </div>
                <pre className="px-3 py-3 text-xs text-gray-700 whitespace-pre-wrap font-sans leading-relaxed select-all">
                  {seg.text}
                </pre>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Weekly panel (right) */}
      <div className="relative z-10 w-[300px] h-full bg-white shadow-xl flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <h3 className="text-base font-semibold text-gray-800 flex items-center gap-2 min-w-0">
            <Bell className="w-4 h-4 text-green-500 shrink-0" />
            <span className="truncate">本周新增{weekLabel ? ` · ${weekLabel}` : ''}</span>
            <span className="text-[10px] text-gray-400 font-normal shrink-0">近5个工作日</span>
          </h3>
          <div className="flex items-center gap-1.5 shrink-0 ml-2">
            <button
              onClick={openCopyMode}
              className={`flex items-center gap-1 px-2.5 h-7 rounded-lg text-xs font-medium transition-all ${
                copyMode
                  ? 'bg-red-500 text-white'
                  : 'border border-red-200 text-red-500 hover:bg-red-50'
              }`}
            >
              <Megaphone className="w-3.5 h-3.5" />招聘文案
            </button>
            <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400"><X className="w-5 h-5" /></button>
          </div>
        </div>
        <div className="overflow-y-auto flex-1 px-5 py-4 text-sm">
          {weeklyJds.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-gray-500 text-sm">近 5 个工作日暂无新增岗位</p>
              <p className="text-gray-400 text-xs mt-1">导入面板里真正新增的岗位会自动出现在这里，5 个工作日后滚动移出。</p>
            </div>
          ) : (
            <>
              <p className="text-gray-500 text-xs mb-3">
                近 5 个工作日新增 <span className="font-semibold text-gray-800">{weeklyJds.length}</span> 个岗位
                {copyMode ? '（取消勾选可从文案中排除）' : '（点击查看详情）'}
              </p>
              <ul className="space-y-0.5">
                {weeklyJds.map((jd) => {
                  const isActive = previewJd?.id === jd.id;
                  const isExcluded = excludedIds.has(jd.id);
                  return (
                    <li
                      key={jd.id}
                      onClick={() => (copyMode ? toggleExclude(jd.id) : handleItemClick(jd))}
                      className={
                        'text-xs flex items-baseline gap-1.5 cursor-pointer rounded-md px-1 py-0.5 -mx-1 hover:bg-gray-50 transition-colors'
                        + (isActive ? ' bg-indigo-50' : '')
                        + (copyMode && isExcluded ? ' text-gray-300' : ' text-gray-700')
                      }
                    >
                      {copyMode ? (
                        <span className={'shrink-0 w-3.5 h-3.5 rounded border flex items-center justify-center self-center ' + (isExcluded ? 'border-gray-300 bg-white' : 'border-green-500 bg-green-500')}>
                          {!isExcluded && <Check className="w-2.5 h-2.5 text-white" />}
                        </span>
                      ) : (
                        <span className="text-green-500 shrink-0">·</span>
                      )}
                      <span className={(copyMode && isExcluded ? 'line-through' : 'hover:text-indigo-600') + ' transition-colors'}>{jd.title}</span>
                      {(jd.organization || jd.department) && (
                        <span className="text-gray-400 shrink-0">{[jd.organization, jd.department].filter(Boolean).join(' · ')}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function parseSalary(s: string): { min: number; max: number; currency: string } {
  if (!s) return { min: 0, max: 0, currency: 'K' };
  const match = s.replace(/[,，]/g, '').match(/(\d+)\s*[-~至到]\s*(\d+)\s*([kKw万])?/i);
  if (match) {
    const mult = match[3]?.toLowerCase() === '万' ? 10 : 1;
    return { min: Math.max(0, parseInt(match[1]) * mult), max: Math.max(0, parseInt(match[2]) * mult), currency: match[3]?.toUpperCase() || 'K' };
  }
  return { min: 0, max: 0, currency: 'K' };
}
