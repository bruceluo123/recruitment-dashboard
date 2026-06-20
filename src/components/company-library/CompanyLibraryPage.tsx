'use client';
import { useState, useEffect } from 'react';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { EmptyState } from '@/components/ui/EmptyState';
import { JDCategoryTabs } from '@/components/jd-library/JDCategoryTabs';
import { CompanyTable } from './CompanyTable';
import { CompanyDetailPanel } from './CompanyDetailPanel';
import { CompanyResearchDialog } from './CompanyResearchDialog';
import { useCompanyStore, useFilteredCompanies, useCompanyCategoryCounts } from '@/store/company-store';
import { hasResearch } from '@/types/company';
import { Building2, Search, Plus, Trash2, Sparkles } from 'lucide-react';

export function CompanyLibraryPage() {
  const [mounted, setMounted] = useState(false);
  const [viewId, setViewId] = useState<string | null>(null);
  const [batchMode, setBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [researchOpen, setResearchOpen] = useState(false);

  const companies = useCompanyStore((s) => s.companies);
  const filter = useCompanyStore((s) => s.filter);
  const setFilter = useCompanyStore((s) => s.setFilter);
  const createBlankCompany = useCompanyStore((s) => s.createBlankCompany);
  const deleteCompany = useCompanyStore((s) => s.deleteCompany);
  const deleteCompanyBatch = useCompanyStore((s) => s.deleteCompanyBatch);
  const undoDeleteCompany = useCompanyStore((s) => s.undoDeleteCompany);
  const lastDeletedCompany = useCompanyStore((s) => s.lastDeletedCompany);
  const filteredCompanies = useFilteredCompanies();
  const categories = useCompanyCategoryCounts();

  const researchedCount = companies.filter((c) => hasResearch(c)).length;
  const pendingCount = companies.length - researchedCount;

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!lastDeletedCompany) return;
    const t = setTimeout(() => useCompanyStore.setState({ lastDeletedCompany: null }), 10000);
    return () => clearTimeout(t);
  }, [lastDeletedCompany]);
  if (!mounted) return null;

  const viewTarget = companies.find((c) => c.id === viewId) || null;
  const visibleIds = filteredCompanies.map((c) => c.id);
  const visibleSelectedCount = selectedIds.filter((id) => visibleIds.includes(id)).length;

  const handleBatchModeChange = (next: boolean) => { setBatchMode(next); setSelectedIds([]); };
  const handleToggleSelect = (id: string) => setSelectedIds((ids) => ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  const handleToggleSelectAll = () => setSelectedIds((ids) => {
    const visibleSet = new Set(visibleIds);
    const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => ids.includes(id));
    if (allVisibleSelected) return ids.filter((id) => !visibleSet.has(id));
    return Array.from(new Set([...ids, ...visibleIds]));
  });
  const handleBatchDelete = () => {
    if (selectedIds.length === 0) return;
    deleteCompanyBatch(selectedIds);
    setSelectedIds([]);
    setBatchMode(false);
  };
  const handleAdd = () => { const id = createBlankCompany(); setViewId(id); };

  return (
    <div className="animate-fade-in space-y-5 max-w-7xl mx-auto">
      <div>
        <h2 className="text-2xl font-bold text-gray-800">公司库</h2>
        <p className="text-sm text-gray-500 mt-1">
          共 {companies.length} 家公司
          <span className="text-gray-400"> · 已研究 {researchedCount}</span>
          {pendingCount > 0 && <span className="text-amber-600"> · 待研究 {pendingCount}</span>}
          {' · '}
          <button onClick={() => handleBatchModeChange(true)} className="text-red-500 hover:text-red-600 underline text-xs">批量删除</button>
        </p>
      </div>

      <JDCategoryTabs categories={categories} activeCategory={filter.category} onCategoryChange={(cat) => setFilter({ category: cat })} />

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input value={filter.search} onChange={(e) => setFilter({ search: e.target.value })}
            placeholder="搜索公司名 / 行业 / 研究内容..."
            className="w-full h-10 pl-9 pr-3 rounded-xl bg-white border border-gray-200 text-sm focus:outline-none focus:border-indigo-300 transition-all" />
        </div>
        <button onClick={() => setResearchOpen(true)} className="h-10 px-4 rounded-xl bg-gradient-to-r from-indigo-500 to-cyan-500 text-white text-sm font-medium hover:opacity-90 transition-all flex items-center gap-2">
          <Sparkles className="w-4 h-4" />调研公司
        </button>
        <button onClick={handleAdd} className="h-10 px-4 rounded-xl bg-white border border-indigo-200 text-indigo-600 text-sm font-medium hover:bg-indigo-50 transition-all flex items-center gap-2">
          <Plus className="w-4 h-4" />添加公司
        </button>
      </div>

      {batchMode && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-red-100 bg-red-50 px-4 py-3">
          <span className="text-sm text-red-700">已选择 {selectedIds.length} 家{visibleSelectedCount !== selectedIds.length ? `，当前列表 ${visibleSelectedCount} 家` : ''}</span>
          <div className="flex items-center gap-2">
            <button onClick={handleToggleSelectAll} className="h-9 px-3 rounded-lg bg-white border border-red-100 text-sm text-red-600 hover:bg-red-50 transition-all">
              {visibleSelectedCount === filteredCompanies.length && filteredCompanies.length > 0 ? '取消全选' : '全选当前'}
            </button>
            <button onClick={handleBatchDelete} disabled={selectedIds.length === 0} className="h-9 px-3 rounded-lg bg-red-500 text-white text-sm font-medium hover:bg-red-600 disabled:opacity-40 transition-all flex items-center gap-2">
              <Trash2 className="w-4 h-4" />删除选中
            </button>
            <button onClick={() => handleBatchModeChange(false)} className="h-9 px-3 rounded-lg bg-white border border-gray-200 text-sm text-gray-500 hover:text-gray-700 transition-all">取消</button>
          </div>
        </div>
      )}

      <GlassPanel padding="none">
        {filteredCompanies.length > 0 ? (
          <CompanyTable
            companies={filteredCompanies}
            onView={setViewId}
            onDelete={deleteCompany}
            batchMode={batchMode}
            selectedIds={selectedIds}
            onToggleSelect={handleToggleSelect}
            onToggleSelectAll={handleToggleSelectAll}
          />
        ) : (
          <EmptyState icon={Building2} title={companies.length === 0 ? '暂无公司数据' : '无匹配结果'}
            description={companies.length === 0 ? '点击"添加公司"手动录入，或用公司研究 skill 按 11 维度自动写入' : '尝试调整筛选条件'} />
        )}
      </GlassPanel>

      <CompanyResearchDialog isOpen={researchOpen} onClose={() => setResearchOpen(false)} onDone={(id) => setViewId(id)} />

      <CompanyDetailPanel company={viewTarget} isOpen={!!viewId} onClose={() => setViewId(null)} />

      {lastDeletedCompany && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-fade-in">
          <div className="bg-gray-800 text-white rounded-xl shadow-lg px-5 py-3 flex items-center gap-4">
            <span className="text-sm">已删除「{lastDeletedCompany.name}」</span>
            <button onClick={() => undoDeleteCompany()} className="text-sm font-medium text-indigo-300 hover:text-indigo-200 whitespace-nowrap">撤销</button>
          </div>
        </div>
      )}
    </div>
  );
}
