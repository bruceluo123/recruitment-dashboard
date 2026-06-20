'use client';
import { cn } from '@/lib/utils';
import { JD_CATEGORY_LABELS, JD_CATEGORY_COLORS } from '@/types/jd';
import type { Company } from '@/types/company';
import { hasResearch } from '@/types/company';
import { Building2, Eye, Trash2, CheckCircle2, CircleDashed } from 'lucide-react';

interface CompanyTableProps {
  companies: Company[];
  onView: (id: string) => void;
  onDelete: (id: string) => void;
  batchMode?: boolean;
  selectedIds?: string[];
  onToggleSelect?: (id: string) => void;
  onToggleSelectAll?: () => void;
}

export function CompanyTable({ companies, onView, onDelete, batchMode = false, selectedIds = [], onToggleSelect, onToggleSelectAll }: CompanyTableProps) {
  if (companies.length === 0) return <div className="text-center py-12 text-gray-400"><p>暂无匹配的公司</p></div>;

  const selectedSet = new Set(selectedIds);
  const allSelected = companies.length > 0 && companies.every((c) => selectedSet.has(c.id));

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] table-fixed">
        <colgroup>
          {batchMode && <col className="w-10" />}
          <col className="w-[240px]" />
          <col className="w-[120px]" />
          <col className="w-[110px]" />
          <col />
          <col className="w-20" />
        </colgroup>
        <thead>
          <tr className="border-b border-gray-100">
            {batchMode && (
              <th className="py-3 px-4">
                <input type="checkbox" checked={allSelected} onChange={onToggleSelectAll}
                  className="w-4 h-4 rounded border-gray-300 text-indigo-500 focus:ring-indigo-200" aria-label="全选当前列表" />
              </th>
            )}
            <th className="text-left py-3 px-4 text-xs font-medium text-gray-400 uppercase tracking-wider">公司名称</th>
            <th className="text-left py-3 px-4 text-xs font-medium text-gray-400 uppercase tracking-wider">行业</th>
            <th className="text-left py-3 px-4 text-xs font-medium text-gray-400 uppercase tracking-wider">研究状态</th>
            <th className="text-left py-3 px-4 text-xs font-medium text-gray-400 uppercase tracking-wider">方向 / 备注</th>
            <th className="w-20" />
          </tr>
        </thead>
        <tbody>
          {companies.map((c) => {
            const researched = hasResearch(c);
            return (
              <tr key={c.id} className={cn('border-b border-gray-50 group transition-colors',
                selectedSet.has(c.id) ? 'bg-red-50/50' : 'hover:bg-gray-50 cursor-pointer')}
                onClick={() => !batchMode && onView(c.id)}>
                {batchMode && (
                  <td className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selectedSet.has(c.id)} onChange={() => onToggleSelect?.(c.id)}
                      className="w-4 h-4 rounded border-gray-300 text-indigo-500 focus:ring-indigo-200" aria-label={`选择${c.name}`} />
                  </td>
                )}
                <td className="py-3 px-4">
                  <p className="text-sm font-medium text-gray-800 flex items-center gap-1.5 truncate">
                    <Building2 className="w-3.5 h-3.5 text-indigo-400 shrink-0" />{c.name || '-'}
                  </p>
                </td>
                <td className="py-3 px-4"><p className="text-sm text-gray-600 truncate">{c.industry || '-'}</p></td>
                <td className="py-3 px-4">
                  {researched ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200">
                      <CheckCircle2 className="w-3 h-3" />已研究
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-gray-100 text-gray-500 ring-1 ring-inset ring-gray-200">
                      <CircleDashed className="w-3 h-3" />待研究
                    </span>
                  )}
                </td>
                <td className="py-3 px-4">
                  <div className="flex items-center gap-1 flex-wrap">
                    {(c.categories || []).slice(0, 3).map((cat) => (
                      <span key={cat} className={cn('px-1.5 py-0.5 rounded text-xs font-medium', JD_CATEGORY_COLORS[cat])}>{JD_CATEGORY_LABELS[cat]}</span>
                    ))}
                    {c.summary && <span className="text-xs text-gray-400 truncate max-w-[260px]">{c.summary}</span>}
                  </div>
                </td>
                <td className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
                  {!batchMode && (
                    <div className="flex items-center gap-1 justify-end">
                      <button onClick={() => onView(c.id)} className="p-1.5 rounded-lg hover:bg-indigo-50 text-gray-300 hover:text-indigo-500 transition-all" title="查看详情"><Eye className="w-4 h-4" /></button>
                      <button onClick={() => onDelete(c.id)} className="p-1.5 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-500 transition-all opacity-0 group-hover:opacity-100" title="删除公司"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
