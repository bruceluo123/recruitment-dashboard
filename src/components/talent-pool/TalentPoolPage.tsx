'use client';
import { useState, useEffect, useCallback } from 'react';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { EmptyState } from '@/components/ui/EmptyState';
import { JDCategoryTabs } from '@/components/jd-library/JDCategoryTabs';
import { TalentTable } from './TalentTable';
import { TalentImportDialog } from './TalentImportDialog';
import { TalentMatchDialog } from './TalentMatchDialog';
import { TalentEditPanel } from './TalentEditPanel';
import { TalentEnrichDialog } from './TalentEnrichDialog';
import { RecycleBinDialog } from '@/components/common/RecycleBinDialog';
import { useTalentStore, useFilteredTalents, useTalentCategoryCounts } from '@/store/talent-store';
import { useRepushStore } from '@/store/repush-store';
import { generateId } from '@/lib/utils';
import { detectCategories } from '@/lib/jd-parse-core';
import { exportTalentsToFeishuXlsx } from '@/lib/talent-feishu-export';
import { Users, Search, Upload, Plus, Trash2, Sparkles, ScanLine, Loader2, Download, Archive, UserPlus, Wand2 } from 'lucide-react';

export function TalentPoolPage() {
  const [mounted, setMounted] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [matchOpen, setMatchOpen] = useState(false);
  const [enrichOpen, setEnrichOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [batchMode, setBatchMode] = useState(false);
  const [recycleOpen, setRecycleOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [scanErrors, setScanErrors] = useState<string[]>([]);
  const [scanSummary, setScanSummary] = useState<{ scanned: number; failed: number } | null>(null);
  const [archiveView, setArchiveView] = useState<'active' | 'all' | 'archived'>('active');
  const [archiveConfirm, setArchiveConfirm] = useState(false);

  const talents = useTalentStore((s) => s.talents);
  const filter = useTalentStore((s) => s.filter);
  const setFilter = useTalentStore((s) => s.setFilter);
  const archiveAll = useTalentStore((s) => s.archiveAll);
  const repushItems = useRepushStore((s) => s.items);
  const repushColumnNames = useRepushStore((s) => s.columnNames);
  const addTalent = useTalentStore((s) => s.addTalent);
  const deleteTalent = useTalentStore((s) => s.deleteTalent);
  const deleteTalentBatch = useTalentStore((s) => s.deleteTalentBatch);
  const undoDeleteTalent = useTalentStore((s) => s.undoDeleteTalent);
  const lastDeletedTalent = useTalentStore((s) => s.lastDeletedTalent);
  const isScanning = useTalentStore((s) => s.isScanning);
  const scanProgress = useTalentStore((s) => s.scanProgress);
  const scanResumes = useTalentStore((s) => s.scanResumes);
  const cancelScan = useTalentStore((s) => s.cancelScan);
  const filteredTalents = useFilteredTalents();
  const categories = useTalentCategoryCounts();

  const activeTalents = talents.filter((t) => !t.archived);
  const archivedCount = talents.filter((t) => t.archived).length;
  const withResumeCount = activeTalents.filter((t) => t.resumeUrl).length;
  const scannedCount = activeTalents.filter((t) => t.resumeUrl && t.hasResumeText).length;
  const unscannedCount = withResumeCount - scannedCount;
  const noResumeCount = activeTalents.length - withResumeCount;

  // 把 archiveView 同步进 filter（useFilteredTalents 会读它）
  useEffect(() => { setFilter({ archiveView } as Parameters<typeof setFilter>[0]); }, [archiveView, setFilter]);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!lastDeletedTalent) return;
    const t = setTimeout(() => useTalentStore.setState({ lastDeletedTalent: null }), 10000);
    return () => clearTimeout(t);
  }, [lastDeletedTalent]);

  const editTarget = talents.find((t) => t.id === editId) || null;
  const visibleIds = filteredTalents.map((t) => t.id);
  const visibleSelectedCount = selectedIds.filter((id) => visibleIds.includes(id)).length;

  const handleBatchModeChange = (next: boolean) => {
    setBatchMode(next);
    setSelectedIds([]);
  };

  // useCallback：保持引用稳定，让 memo 化的 TalentTable 不因父组件重渲染而整表 reconcile
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

  const handleBatchDelete = () => {
    if (selectedIds.length === 0) return;
    // 批量删除经墓碑机制会同步到全团队且不可撤销，删除前二次确认(展示数量+抽样名单)
    const sample = selectedIds.slice(0, 5)
      .map((id) => talents.find((t) => t.id === id)?.name || id)
      .join('、');
    const more = selectedIds.length > 5 ? ` 等 ${selectedIds.length} 人` : '';
    if (!window.confirm(`确认删除选中的 ${selectedIds.length} 位人选？\n\n${sample}${more}\n\n此操作会同步到全团队，且无法撤销。`)) return;
    deleteTalentBatch(selectedIds);
    setSelectedIds([]);
    setBatchMode(false);
  };

  const handleImportFromRecommendation = () => {
    const existingTalents = useTalentStore.getState().talents;
    const now = new Date().toISOString();
    let created = 0;
    let updated = 0;
    let resumesLinked = 0;
    // 简历资产全链路：导入后需要后台提取简历文字的人才（有 Blob 文件且尚未扫描）
    const toScan: Array<{ talentId: string; url: string; fileName?: string }> = [];

    for (const item of repushItems) {
      const name = (item.candidateName || '').trim();
      if (!name) continue;
      const jobTitle = (item.jdTitle || '').trim();
      const existing = existingTalents.find((t) => t.name === name);
      const recruiter = item.contactPerson?.trim() || repushColumnNames[item.column] || undefined;
      const cats = detectCategories(jobTitle);
      // 推荐记录里的简历文件跟随导入（已有简历的人才不覆盖）
      const itemResume = item.resumeUrl ? { resumeUrl: item.resumeUrl, resumeFileName: item.resumeFileName } : null;

      let talentId: string;
      if (existing) {
        talentId = existing.id;
        const attachResume = itemResume && !existing.resumeUrl;
        useTalentStore.getState().updateTalent(existing.id, {
          jobTitle: jobTitle || existing.jobTitle,
          organization: item.organization?.trim() || existing.organization,
          department: item.department?.trim() || existing.department,
          phone: item.contact?.trim() || existing.phone,
          recruiter: recruiter || existing.recruiter,
          archived: false,
          ...(attachResume ? itemResume : {}),
        });
        if (attachResume) { resumesLinked++; if (!existing.hasResumeText) toScan.push({ talentId, url: itemResume.resumeUrl!, fileName: itemResume.resumeFileName }); }
        updated++;
      } else {
        talentId = generateId();
        useTalentStore.getState().addTalent({
          id: talentId,
          name,
          jobTitle,
          categories: cats.length ? cats : ['operations'],
          organization: item.organization?.trim() || undefined,
          department: item.department?.trim() || undefined,
          phone: item.contact?.trim() || undefined,
          recruiter,
          archived: false,
          tg: '',
          // 新建时把 AI 亮点摘要一并沉淀到备注（原来这份信息在导入时丢失）
          notes: item.highlights ? `【推荐亮点】${item.highlights}` : '',
          ...(itemResume || {}),
          createdAt: now,
          updatedAt: now,
        });
        if (itemResume) { resumesLinked++; toScan.push({ talentId, url: itemResume.resumeUrl!, fileName: itemResume.resumeFileName }); }
        created++;
      }
      // 回写跨模块主键：推荐记录 ↔ 人才库 双向关联
      if (item.talentId !== talentId) useRepushStore.getState().updateItem(item.id, { talentId });
    }

    // 后台逐个提取简历文字（走已有 /api/talent/scan 管道），完成后标记 hasResumeText，
    // 使「JD 匹配人选」立即可用这些新导入的简历。失败不打扰用户，人才记录已建好。
    if (toScan.length) {
      (async () => {
        for (const s of toScan) {
          try {
            const res = await fetch('/api/talent/scan', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: s.talentId, url: s.url, fileName: s.fileName }),
            });
            const data = (await res.json()) as { chars?: number; error?: string };
            if (res.ok && !data.error) {
              useTalentStore.getState().updateTalent(s.talentId, { hasResumeText: true, resumeChars: data.chars });
            }
          } catch (err) {
            console.warn('导入后简历扫描失败', s.talentId, err);
          }
        }
      })();
    }

    alert(`导入完成：新建 ${created} 位，更新 ${updated} 位${resumesLinked ? `，关联简历 ${resumesLinked} 份（文字提取在后台进行）` : ''}`);
  };

  const handleExportFeishu = async () => {
    if (filteredTalents.length === 0) return;
    await exportTalentsToFeishuXlsx(filteredTalents);
  };

  const handleAddTalent = () => {
    const id = generateId();
    addTalent({
      id, name: '新人选', jobTitle: '', categories: ['operations'],
      tg: '', notes: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    setEditId(id);
  };

  // 水合守卫：放在所有 hook 之后，避免条件调用 hook
  if (!mounted) return null;

  return (
    <div className="animate-fade-in space-y-5 max-w-7xl mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">人才库</h2>
          <p className="text-sm text-gray-500 mt-1">
            活跃 {activeTalents.length} 位
            {archivedCount > 0 && <span className="text-gray-400"> · 归档 {archivedCount} 位</span>}
            <span className="text-gray-400"> · 已扫描 {scannedCount}</span>
            {unscannedCount > 0 && <span className="text-amber-600"> · 待扫描 {unscannedCount}</span>}
            {noResumeCount > 0 && <span className="text-gray-400"> · 无简历 {noResumeCount}</span>}
            {' · '}
            <button onClick={() => handleBatchModeChange(true)} className="text-red-500 hover:text-red-600 underline text-xs">批量删除</button>
            {' · '}
            <button onClick={() => setRecycleOpen(true)} className="text-gray-500 hover:text-gray-700 underline text-xs">回收站</button>
          </p>
        </div>
        {/* 视图切换 + 归档全部 */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="inline-flex rounded-xl border border-gray-200 p-0.5 bg-gray-50 text-sm">
            {(['active', 'all', 'archived'] as const).map((v) => (
              <button key={v} onClick={() => setArchiveView(v)}
                className={`px-3 h-8 rounded-lg font-medium transition-all ${archiveView === v ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                {v === 'active' ? '活跃' : v === 'all' ? '全部' : '归档'}
              </button>
            ))}
          </div>
          <button onClick={() => setArchiveConfirm(true)} disabled={activeTalents.length === 0}
            className="h-9 px-3 rounded-xl border border-gray-200 bg-white text-sm text-gray-600 hover:bg-amber-50 hover:border-amber-200 hover:text-amber-700 transition-all flex items-center gap-1.5 disabled:opacity-40"
            title="把当前所有活跃人才标记为归档（不删除数据）">
            <Archive className="w-3.5 h-3.5" />归档全部旧人才
          </button>
        </div>
      </div>

      <JDCategoryTabs categories={categories} activeCategory={filter.category} onCategoryChange={(cat) => setFilter({ category: cat })} />

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input value={filter.search} onChange={(e) => setFilter({ search: e.target.value })}
            placeholder="搜索姓名 / 岗位 / TG / 备注..."
            className="w-full h-10 pl-9 pr-3 rounded-xl bg-white border border-gray-200 text-sm focus:outline-none focus:border-indigo-300 transition-all" />
        </div>
        <button onClick={() => setMatchOpen(true)} className="h-10 px-4 rounded-xl bg-gradient-to-r from-indigo-500 to-cyan-500 text-white text-sm font-medium hover:opacity-90 transition-all flex items-center gap-2">
          <Sparkles className="w-4 h-4" />JD 匹配人选
        </button>
        <button onClick={async () => { setScanErrors([]); setScanSummary(null); const r = await scanResumes(); setScanSummary({ scanned: r.scanned, failed: r.failed }); setScanErrors(r.errors); }} disabled={isScanning || unscannedCount === 0}
          className="h-10 px-4 rounded-xl bg-white border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-all flex items-center gap-2 disabled:opacity-50"
          title={unscannedCount === 0 ? '所有简历已扫描' : `${unscannedCount} 份待扫描`}>
          {isScanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanLine className="w-4 h-4" />}
          扫描识别简历{unscannedCount > 0 ? ` (${unscannedCount})` : ''}
        </button>
        <button onClick={() => setImportOpen(true)} className="h-10 px-4 rounded-xl bg-indigo-500 text-white text-sm font-medium hover:bg-indigo-600 transition-all flex items-center gap-2">
          <Upload className="w-4 h-4" />批量导入
        </button>
        <button onClick={() => setEnrichOpen(true)} className="h-10 px-4 rounded-xl bg-white border border-purple-200 text-purple-600 text-sm font-medium hover:bg-purple-50 transition-all flex items-center gap-2">
          <Wand2 className="w-4 h-4" />充实档案
        </button>
        <button onClick={handleImportFromRecommendation} disabled={repushItems.length === 0}
          className="h-10 px-4 rounded-xl bg-white border border-indigo-200 text-indigo-600 text-sm font-medium hover:bg-indigo-50 transition-all flex items-center gap-2 disabled:opacity-40"
          title={`从推荐中心导入全部 ${repushItems.length} 条推荐记录`}>
          <UserPlus className="w-4 h-4" />从推荐中心导入
        </button>
        <button onClick={handleExportFeishu} disabled={filteredTalents.length === 0}
          className="h-10 px-4 rounded-xl bg-white border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-all flex items-center gap-2 disabled:opacity-50"
          title={`导出当前 ${filteredTalents.length} 位人选为飞书格式 .xlsx`}>
          <Download className="w-4 h-4" />导出飞书格式
        </button>
        <button onClick={handleAddTalent} className="h-10 px-4 rounded-xl bg-white border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-all flex items-center gap-2">
          <Plus className="w-4 h-4" />添加人选
        </button>
      </div>

      {isScanning && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between text-sm mb-1.5">
              <span className="text-indigo-700 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />识别简历文字 + AI 分类中... 成功 {scanProgress.succeeded} · 失败 {scanProgress.failed}</span>
              <span className="text-indigo-400">{scanProgress.current}/{scanProgress.total}</span>
            </div>
            <div className="w-full h-2 bg-white rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-indigo-500 to-cyan-500 rounded-full transition-all duration-150"
                style={{ width: `${scanProgress.total ? Math.round((scanProgress.current / scanProgress.total) * 100) : 0}%` }} />
            </div>
          </div>
          <button onClick={cancelScan} className="h-9 px-3 rounded-lg border border-red-200 text-red-500 text-sm font-medium hover:bg-red-50 transition-all whitespace-nowrap">停止</button>
        </div>
      )}

      {!isScanning && scanSummary && (
        <div className={`rounded-xl border px-4 py-3 ${scanSummary.failed > 0 ? 'border-amber-200 bg-amber-50' : 'border-emerald-200 bg-emerald-50'}`}>
          <div className="flex items-center justify-between gap-3">
            <span className={`text-sm font-medium ${scanSummary.failed > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
              扫描完成：成功 {scanSummary.scanned} 份{scanSummary.failed > 0 ? ` · 失败 ${scanSummary.failed} 份` : ''}
            </span>
            <button onClick={() => { setScanSummary(null); setScanErrors([]); }} className="text-xs text-gray-500 hover:text-gray-700">关闭</button>
          </div>
          {scanErrors.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs text-amber-700/90 max-h-40 overflow-y-auto">
              {scanErrors.slice(0, 10).map((e, i) => <li key={i} className="truncate">· {e}</li>)}
              {scanErrors.length > 10 && <li className="text-amber-600">…还有 {scanErrors.length - 10} 条</li>}
            </ul>
          )}
        </div>
      )}

      {batchMode && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-red-100 bg-red-50 px-4 py-3">
          <span className="text-sm text-red-700">已选择 {selectedIds.length} 位{visibleSelectedCount !== selectedIds.length ? `，当前列表 ${visibleSelectedCount} 位` : ''}</span>
          <div className="flex items-center gap-2">
            <button onClick={handleToggleSelectAll} className="h-9 px-3 rounded-lg bg-white border border-red-100 text-sm text-red-600 hover:bg-red-50 transition-all">
              {visibleSelectedCount === filteredTalents.length && filteredTalents.length > 0 ? '取消全选' : '全选当前'}
            </button>
            <button onClick={handleBatchDelete} disabled={selectedIds.length === 0} className="h-9 px-3 rounded-lg bg-red-500 text-white text-sm font-medium hover:bg-red-600 disabled:opacity-40 transition-all flex items-center gap-2">
              <Trash2 className="w-4 h-4" />删除选中
            </button>
            <button onClick={() => handleBatchModeChange(false)} className="h-9 px-3 rounded-lg bg-white border border-gray-200 text-sm text-gray-500 hover:text-gray-700 transition-all">取消</button>
          </div>
        </div>
      )}

      <GlassPanel padding="none">
        {filteredTalents.length > 0 ? (
          <TalentTable
            talents={filteredTalents}
            onEdit={setEditId}
            onDelete={deleteTalent}
            batchMode={batchMode}
            selectedIds={selectedIds}
            onToggleSelect={handleToggleSelect}
            onToggleSelectAll={handleToggleSelectAll}
          />
        ) : (
          <EmptyState icon={Users} title={talents.length === 0 ? '暂无人选数据' : '无匹配结果'} description={talents.length === 0 ? '点击"批量导入"上传简历，或"添加人选"手动录入' : '尝试调整筛选条件'} />
        )}
      </GlassPanel>

      <TalentEditPanel talent={editTarget} isOpen={!!editId} onClose={() => setEditId(null)} />
      <RecycleBinDialog type="talent" open={recycleOpen} onClose={() => setRecycleOpen(false)} />
      <TalentImportDialog isOpen={importOpen} onClose={() => setImportOpen(false)} />
      <TalentMatchDialog isOpen={matchOpen} onClose={() => setMatchOpen(false)} />
      <TalentEnrichDialog isOpen={enrichOpen} onClose={() => setEnrichOpen(false)} />

      {/* 归档确认弹窗 */}
      {archiveConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/30" onClick={() => setArchiveConfirm(false)} />
          <div className="relative bg-white rounded-2xl shadow-xl border border-gray-200 p-6 max-w-sm w-full space-y-4 animate-fade-in">
            <div className="flex items-center gap-3">
              <Archive className="w-5 h-5 text-amber-500" />
              <h3 className="text-base font-semibold text-gray-800">归档全部旧人才</h3>
            </div>
            <p className="text-sm text-gray-600">
              将当前 <span className="font-medium text-gray-800">{activeTalents.length}</span> 位活跃人才全部标记为归档。
              <br />数据不会删除，随时可在「归档」视图查看或恢复。
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setArchiveConfirm(false)}
                className="h-9 px-4 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-all">取消</button>
              <button onClick={() => { archiveAll(); setArchiveConfirm(false); setArchiveView('archived'); }}
                className="h-9 px-4 rounded-xl bg-amber-500 text-white text-sm font-medium hover:bg-amber-600 transition-all flex items-center gap-2">
                <Archive className="w-4 h-4" />确认归档
              </button>
            </div>
          </div>
        </div>
      )}

      {lastDeletedTalent && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-fade-in">
          <div className="bg-gray-800 text-white rounded-xl shadow-lg px-5 py-3 flex items-center gap-4">
            <span className="text-sm">已删除「{lastDeletedTalent.name}」</span>
            <button onClick={() => undoDeleteTalent()} className="text-sm font-medium text-indigo-300 hover:text-indigo-200 whitespace-nowrap">撤销</button>
          </div>
        </div>
      )}
    </div>
  );
}
