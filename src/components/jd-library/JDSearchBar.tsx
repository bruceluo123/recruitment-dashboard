'use client';
import { Search, Upload, SlidersHorizontal, Plus, CheckSquare, Bell } from 'lucide-react';

interface JDSearchBarProps {
  search: string; onSearchChange: (value: string) => void;
  onImportClick: () => void; onAddClick: () => void;
  activeOnly: boolean; onActiveOnlyChange: (v: boolean) => void;
  batchMode: boolean; onBatchModeChange: (v: boolean) => void;
  hasDiff?: boolean; onDiffClick?: () => void;
}

export function JDSearchBar({ search, onSearchChange, onImportClick, onAddClick, activeOnly, onActiveOnlyChange, batchMode, onBatchModeChange, hasDiff, onDiffClick }: JDSearchBarProps) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <div className="relative flex-1 min-w-[200px] max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input value={search} onChange={(e) => onSearchChange(e.target.value)} placeholder="搜索岗位名称、部门、职责..." className="w-full h-10 pl-9 pr-4 rounded-xl bg-white border border-gray-200 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:border-indigo-300 transition-all" />
      </div>
      <button onClick={() => onActiveOnlyChange(!activeOnly)} className={`h-10 px-3 rounded-xl border text-sm font-medium transition-all flex items-center gap-2 ${activeOnly ? 'bg-green-50 text-green-700 border-green-200' : 'bg-white text-gray-500 border-gray-200 hover:text-gray-700'}`}>
        <SlidersHorizontal className="w-4 h-4" />仅活跃
      </button>
      <button onClick={() => onBatchModeChange(!batchMode)} className={`h-10 px-3 rounded-xl border text-sm font-medium transition-all flex items-center gap-2 ${batchMode ? 'bg-red-50 text-red-600 border-red-200' : 'bg-white text-gray-500 border-gray-200 hover:text-gray-700'}`}>
        <CheckSquare className="w-4 h-4" />批量删除
      </button>
      <button onClick={onAddClick} className="h-10 px-4 rounded-xl bg-indigo-500 text-white text-sm font-medium hover:bg-indigo-600 transition-all flex items-center gap-2">
        <Plus className="w-4 h-4" />添加岗位
      </button>
      <button onClick={onImportClick} className="h-10 px-4 rounded-xl bg-white border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-50 transition-all flex items-center gap-2">
        <Upload className="w-4 h-4" />批量导入
      </button>
      {onDiffClick && (
        <button
          onClick={onDiffClick}
          className="relative h-10 px-4 rounded-xl bg-white border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-50 transition-all flex items-center gap-2"
        >
          <Bell className="w-4 h-4" />今日增改
          {hasDiff && (
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-red-500" />
          )}
        </button>
      )}
    </div>
  );
}
