'use client';
import { cn, formatSalary } from '@/lib/utils';
import { JD_CATEGORY_LABELS, JD_CATEGORY_COLORS, type JD } from '@/types/jd';
import { ChevronRight, Trash2 } from 'lucide-react';

interface JDTableProps {
  jds: JD[];
  onSelect: (id: string) => void;
  selectedId: string | null;
  onDelete: (id: string) => void;
  batchMode?: boolean;
  selectedIds?: string[];
  onToggleSelect?: (id: string) => void;
  onToggleSelectAll?: () => void;
}

export function JDTable({ jds, onSelect, selectedId, onDelete, batchMode = false, selectedIds = [], onToggleSelect, onToggleSelectAll }: JDTableProps) {
  if (jds.length === 0) return <div className="text-center py-12 text-gray-400"><p>暂无匹配的岗位</p></div>;

  const selectedSet = new Set(selectedIds);
  const allSelected = jds.length > 0 && jds.every((jd) => selectedSet.has(jd.id));

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-gray-100">
            {batchMode && (
              <th className="w-10 py-3 px-4">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={onToggleSelectAll}
                  className="w-4 h-4 rounded border-gray-300 text-indigo-500 focus:ring-indigo-200"
                  aria-label="全选当前列表"
                />
              </th>
            )}
            <th className="text-left py-3 px-4 text-xs font-medium text-gray-400 uppercase tracking-wider">岗位名称</th>
            <th className="text-left py-3 px-4 text-xs font-medium text-gray-400 uppercase tracking-wider">分类</th>
            <th className="text-center py-3 px-2 text-xs font-medium text-gray-400 uppercase tracking-wider w-14">HC</th>
            <th className="text-center py-3 px-2 text-xs font-medium text-gray-400 uppercase tracking-wider w-14">缺口</th>
            <th className="text-left py-3 px-4 text-xs font-medium text-gray-400 uppercase tracking-wider">服务单位</th>
            <th className="text-left py-3 px-4 text-xs font-medium text-gray-400 uppercase tracking-wider">薪资</th>
            <th className="text-left py-3 px-4 text-xs font-medium text-gray-400 uppercase tracking-wider">状态</th>
            <th className="w-10" />
          </tr>
        </thead>
        <tbody>
          {jds.map((jd) => (
            <tr key={jd.id} className={cn(
              'border-b border-gray-50 group transition-colors',
              selectedSet.has(jd.id) ? 'bg-red-50/50' : selectedId === jd.id ? 'bg-indigo-50' : 'hover:bg-gray-50',
            )}>
              {batchMode && (
                <td className="py-3 px-4">
                  <input
                    type="checkbox"
                    checked={selectedSet.has(jd.id)}
                    onChange={() => onToggleSelect?.(jd.id)}
                    className="w-4 h-4 rounded border-gray-300 text-indigo-500 focus:ring-indigo-200"
                    aria-label={`选择${jd.title}`}
                  />
                </td>
              )}
              <td className={cn('py-3 px-4', !batchMode && 'cursor-pointer')} onClick={() => batchMode ? onToggleSelect?.(jd.id) : onSelect(jd.id)}>
                <p className="text-sm font-medium text-gray-800">{jd.title}</p>
              </td>
              <td className={cn('py-3 px-4', !batchMode && 'cursor-pointer')} onClick={() => batchMode ? onToggleSelect?.(jd.id) : onSelect(jd.id)}>
                <span className={cn('px-2 py-0.5 rounded-md text-xs font-medium', JD_CATEGORY_COLORS[jd.categories[0]])}>{JD_CATEGORY_LABELS[jd.categories[0]]}</span>
              </td>
              <td className={cn('py-3 px-2 text-center w-14', !batchMode && 'cursor-pointer')} onClick={() => batchMode ? onToggleSelect?.(jd.id) : onSelect(jd.id)}>
                <span className="text-sm font-medium text-gray-700">{jd.headcount || '-'}</span>
              </td>
              <td className={cn('py-3 px-2 text-center w-14', !batchMode && 'cursor-pointer')} onClick={() => batchMode ? onToggleSelect?.(jd.id) : onSelect(jd.id)}>
                <span className={cn('text-sm font-medium', jd.gap && jd.gap !== '0' ? 'text-red-500' : 'text-gray-400')}>{jd.gap || '-'}</span>
              </td>
              <td className={cn('py-3 px-4', !batchMode && 'cursor-pointer')} onClick={() => batchMode ? onToggleSelect?.(jd.id) : onSelect(jd.id)}>
                <p className="text-sm text-gray-500 truncate max-w-[140px]">{jd.serviceUnit || jd.department || '-'}</p>
              </td>
              <td className={cn('py-3 px-4', !batchMode && 'cursor-pointer')} onClick={() => batchMode ? onToggleSelect?.(jd.id) : onSelect(jd.id)}>
                <span className="text-sm text-green-600 font-medium">{jd.salaryText || (jd.salaryRange.min ? formatSalary(jd.salaryRange) : '-')}</span>
              </td>
              <td className={cn('py-3 px-4', !batchMode && 'cursor-pointer')} onClick={() => batchMode ? onToggleSelect?.(jd.id) : onSelect(jd.id)}>
                <span className={cn('inline-flex items-center gap-1.5 text-xs',
                  jd.status === 'urgent' ? 'text-red-600' : jd.status === 'active' ? 'text-green-600' : 'text-gray-400')}>
                  <span className={cn('w-1.5 h-1.5 rounded-full',
                    jd.status === 'urgent' ? 'bg-red-500' : jd.status === 'active' ? 'bg-green-500' : 'bg-gray-300')} />
                  {jd.status === 'urgent' ? '急招' : jd.status === 'active' ? '活跃' : '暂缓'}
                </span>
              </td>
              <td className="py-3 px-4">
                <div className="flex items-center gap-1">
                  {!batchMode && (
                    <>
                      <button onClick={(e) => { e.stopPropagation(); onDelete(jd.id); }}
                        className="p-1.5 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-500 transition-all opacity-0 group-hover:opacity-100"
                        title="删除岗位">
                        <Trash2 className="w-4 h-4" />
                      </button>
                      <ChevronRight className={cn('w-4 h-4 transition-all', selectedId === jd.id ? 'text-indigo-500 rotate-90' : 'text-gray-300')} />
                    </>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
