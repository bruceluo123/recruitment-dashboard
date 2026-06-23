'use client';
import { cn } from '@/lib/utils';
import { JD_CATEGORY_LABELS, JD_CATEGORY_COLORS } from '@/types/jd';
import type { Talent } from '@/types/talent';
import { Pencil, Trash2 } from 'lucide-react';

interface TalentTableProps {
  talents: Talent[];
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  batchMode?: boolean;
  selectedIds?: string[];
  onToggleSelect?: (id: string) => void;
  onToggleSelectAll?: () => void;
}

export function TalentTable({ talents, onEdit, onDelete, batchMode = false, selectedIds = [], onToggleSelect, onToggleSelectAll }: TalentTableProps) {
  if (talents.length === 0) return <div className="text-center py-12 text-gray-400"><p>暂无匹配的人选</p></div>;

  const selectedSet = new Set(selectedIds);
  const allSelected = talents.length > 0 && talents.every((t) => selectedSet.has(t.id));

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-gray-100">
            {batchMode && (
              <th className="w-10 py-3 px-4">
                <input type="checkbox" checked={allSelected} onChange={onToggleSelectAll}
                  className="w-4 h-4 rounded border-gray-300 text-indigo-500 focus:ring-indigo-200" aria-label="全选当前列表" />
              </th>
            )}
            <th className="text-left py-3 px-4 text-xs font-medium text-gray-400 uppercase tracking-wider">姓名</th>
            <th className="text-left py-3 px-4 text-xs font-medium text-gray-400 uppercase tracking-wider">分类</th>
            <th className="text-left py-3 px-4 text-xs font-medium text-gray-400 uppercase tracking-wider">岗位</th>
            <th className="text-left py-3 px-4 text-xs font-medium text-gray-400 uppercase tracking-wider">编制</th>
            <th className="text-left py-3 px-4 text-xs font-medium text-gray-400 uppercase tracking-wider">部门</th>
            <th className="text-left py-3 px-4 text-xs font-medium text-gray-400 uppercase tracking-wider">联系方式</th>
            <th className="text-left py-3 px-4 text-xs font-medium text-gray-400 uppercase tracking-wider">简历对接人</th>
            <th className="w-20" />
          </tr>
        </thead>
        <tbody>
          {talents.map((t) => (
            <tr key={t.id} className={cn(
              'border-b border-gray-50 group transition-colors',
              selectedSet.has(t.id) ? 'bg-red-50/50' : 'hover:bg-gray-50',
            )}>
              {batchMode && (
                <td className="py-3 px-4">
                  <input type="checkbox" checked={selectedSet.has(t.id)} onChange={() => onToggleSelect?.(t.id)}
                    className="w-4 h-4 rounded border-gray-300 text-indigo-500 focus:ring-indigo-200" aria-label={`选择${t.name}`} />
                </td>
              )}

              {/* 姓名 */}
              <td className="py-3 px-4">
                <p className="text-sm font-medium text-gray-800">{t.name || '-'}</p>
                {t.archived && <span className="text-xs text-amber-500">归档</span>}
              </td>

              {/* 分类标签 */}
              <td className="py-3 px-4">
                <div className="flex flex-wrap gap-1">
                  {(t.categories || []).slice(0, 2).map((cat) => (
                    <span key={cat} className={cn('px-2 py-0.5 rounded-md text-xs font-medium', JD_CATEGORY_COLORS[cat])}>
                      {JD_CATEGORY_LABELS[cat]}
                    </span>
                  ))}
                </div>
              </td>

              {/* 岗位 */}
              <td className="py-3 px-4">
                <p className="text-sm text-gray-700 truncate max-w-[180px]">{t.jobTitle || '-'}</p>
              </td>

              {/* 编制 */}
              <td className="py-3 px-4">
                <p className="text-sm text-gray-600 truncate max-w-[160px]">{t.organization || '-'}</p>
              </td>

              {/* 部门 */}
              <td className="py-3 px-4">
                <p className="text-sm text-gray-600 truncate max-w-[120px]">{t.department || '-'}</p>
              </td>

              {/* 联系方式：phone 优先，其次 email，其次 tg */}
              <td className="py-3 px-4">
                <p className="text-sm text-gray-600 truncate max-w-[140px]">
                  {t.phone || t.email || t.tg || '-'}
                </p>
              </td>

              {/* 简历对接人 */}
              <td className="py-3 px-4">
                <p className="text-sm text-gray-600 truncate max-w-[100px]">{t.recruiter || '-'}</p>
              </td>

              {/* 操作 */}
              <td className="py-3 px-4">
                {!batchMode && (
                  <div className="flex items-center gap-1 justify-end">
                    <button onClick={() => onEdit(t.id)}
                      className="p-1.5 rounded-lg hover:bg-indigo-50 text-gray-300 hover:text-indigo-500 transition-all" title="编辑人选">
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button onClick={() => onDelete(t.id)}
                      className="p-1.5 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-500 transition-all opacity-0 group-hover:opacity-100" title="删除人选">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
