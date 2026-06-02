'use client';
import { useState, useEffect } from 'react';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { EmptyState } from '@/components/ui/EmptyState';
import { JDCategoryTabs } from '@/components/jd-library/JDCategoryTabs';
import { TalentTable } from './TalentTable';
import { TalentImportDialog } from './TalentImportDialog';
import { TalentMatchDialog } from './TalentMatchDialog';
import { TalentEditPanel } from './TalentEditPanel';
import { useTalentStore, useFilteredTalents, useTalentCategoryCounts } from '@/store/talent-store';
import { generateId } from '@/lib/utils';
import { Users, Search, Upload, Plus, Trash2, Sparkles, ScanLine, Loader2 } from 'lucide-react';

export function TalentPoolPage() {
  const [mounted, setMounted] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [matchOpen, setMatchOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [batchMode, setBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const talents = useTalentStore((s) => s.talents);
  const filter = useTalentStore((s) => s.filter);
  const setFilter = useTalentStore((s) => s.setFilter);
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

  const unscannedCount = talents.filter((t) => t.resumeUrl && !t.hasResumeText).length;

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!lastDeletedTalent) return;
    const t = setTimeout(() => useTalentStore.setState({ lastDeletedTalent: null }), 10000);
    return () => clearTimeout(t);
  }, [lastDeletedTalent]);
  if (!mounted) return null;

  const editTarget = talents.find((t) => t.id === editId) || null;
  const visibleIds = filteredTalents.map((t) => t.id);
  const visibleSelectedCount = selectedIds.filter((id) => visibleIds.includes(id)).length;

  const handleBatchModeChange = (next: boolean) => {
    setBatchMode(next);
    setSelectedIds([]);
  };

  const handleToggleSelect = (id: string) => {
    setSelectedIds((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]);
  };

  const handleToggleSelectAll = () => {
    setSelectedIds((ids) => {
      const visibleSet = new Set(visibleIds);
      const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => ids.includes(id));
      if (allVisibleSelected) return ids.filter((id) => !visibleSet.has(id));
      return Array.from(new Set([...ids, ...visibleIds]));
    });
  };

  const handleBatchDelete = () => {
    if (selectedIds.length === 0) return;
    deleteTalentBatch(selectedIds);
    setSelectedIds([]);
    setBatchMode(false);
  };

  const handleAddTalent = () => {
    const id = generateId();
    addTalent({
      id, name: '新人选', jobTitle: '', categories: ['operations'],
      tg: '', notes: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    setEditId(id);
  };

  return (
    <div className="animate-fade-in space-y-5 max-w-7xl mx-auto">
      <div>
        <h2 className="text-2xl font-bold text-gray-800">人才库</h2>
        <p className="text-sm text-gray-500 mt-1">
          共 {talents.length} 位人选 ·{' '}
          <button onClick={() => handleBatchModeChange(true)} className="text-red-500 hover:text-red-600 underline text-xs">批量删除</button>
        </p>
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
        <button onClick={() => { void scanResumes(); }} disabled={isScanning || unscannedCount === 0}
          className="h-10 px-4 rounded-xl bg-white border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-all flex items-center gap-2 disabled:opacity-50"
          title={unscannedCount === 0 ? '所有简历已扫描' : `${unscannedCount} 份待扫描`}>
          {isScanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanLine className="w-4 h-4" />}
          扫描识别简历{unscannedCount > 0 ? ` (${unscannedCount})` : ''}
        </button>
        <button onClick={() => setImportOpen(true)} className="h-10 px-4 rounded-xl bg-indigo-500 text-white text-sm font-medium hover:bg-indigo-600 transition-all flex items-center gap-2">
          <Upload className="w-4 h-4" />批量导入
        </button>
        <button onClick={handleAddTalent} className="h-10 px-4 rounded-xl bg-white border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-all flex items-center gap-2">
          <Plus className="w-4 h-4" />添加人选
        </button>
      </div>

      {isScanning && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between text-sm mb-1.5">
              <span className="text-indigo-700 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />识别简历文字中... 成功 {scanProgress.succeeded} · 失败 {scanProgress.failed}</span>
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
      <TalentImportDialog isOpen={importOpen} onClose={() => setImportOpen(false)} />
      <TalentMatchDialog isOpen={matchOpen} onClose={() => setMatchOpen(false)} />

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
