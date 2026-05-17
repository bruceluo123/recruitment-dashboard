'use client';
import { cn, formatSalary } from '@/lib/utils';
import { JD_CATEGORY_LABELS, JD_CATEGORY_COLORS, type JD } from '@/types/jd';
import { ChevronRight, MapPin, Trash2 } from 'lucide-react';

interface JDTableProps { jds: JD[]; onSelect: (id: string) => void; selectedId: string | null; onDelete: (id: string) => void; }

export function JDTable({ jds, onSelect, selectedId, onDelete }: JDTableProps) {
  if (jds.length === 0) return <div className="text-center py-12 text-gray-400"><p>暂无匹配的岗位</p></div>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-gray-100">
            <th className="text-left py-3 px-4 text-xs font-medium text-gray-400 uppercase tracking-wider">岗位名称</th>
            <th className="text-left py-3 px-4 text-xs font-medium text-gray-400 uppercase tracking-wider">分类</th>
            <th className="text-left py-3 px-4 text-xs font-medium text-gray-400 uppercase tracking-wider">部门</th>
            <th className="text-left py-3 px-4 text-xs font-medium text-gray-400 uppercase tracking-wider">薪资</th>
            <th className="text-left py-3 px-4 text-xs font-medium text-gray-400 uppercase tracking-wider">地点</th>
            <th className="text-left py-3 px-4 text-xs font-medium text-gray-400 uppercase tracking-wider">状态</th>
            <th className="w-10" />
          </tr>
        </thead>
        <tbody>
          {jds.map((jd) => (
            <tr key={jd.id} className={cn(
              'border-b border-gray-50 group transition-colors',
              selectedId === jd.id ? 'bg-indigo-50' : 'hover:bg-gray-50',
            )}>
              <td className="py-3 px-4 cursor-pointer" onClick={() => onSelect(jd.id)}>
                <p className="text-sm font-medium text-gray-800">{jd.title}</p>
              </td>
              <td className="py-3 px-4 cursor-pointer" onClick={() => onSelect(jd.id)}>
                <span className={cn('px-2 py-0.5 rounded-md text-xs font-medium', JD_CATEGORY_COLORS[jd.category])}>{JD_CATEGORY_LABELS[jd.category]}</span>
              </td>
              <td className="py-3 px-4 cursor-pointer" onClick={() => onSelect(jd.id)}>
                <p className="text-sm text-gray-500 truncate max-w-[160px]">{jd.department || '-'}</p>
              </td>
              <td className="py-3 px-4 cursor-pointer" onClick={() => onSelect(jd.id)}>
                <span className="text-sm text-green-600 font-medium">{jd.salaryText || (jd.salaryRange.min ? formatSalary(jd.salaryRange) : '-')}</span>
              </td>
              <td className="py-3 px-4 cursor-pointer" onClick={() => onSelect(jd.id)}>
                <div className="flex items-center gap-1 text-sm text-gray-400"><MapPin className="w-3 h-3" />{jd.location || '-'}</div>
              </td>
              <td className="py-3 px-4 cursor-pointer" onClick={() => onSelect(jd.id)}>
                <span className={cn('inline-flex items-center gap-1.5 text-xs', jd.isActive ? 'text-green-600' : 'text-gray-400')}>
                  <span className={cn('w-1.5 h-1.5 rounded-full', jd.isActive ? 'bg-green-500' : 'bg-gray-300')} />{jd.isActive ? '活跃' : '已关闭'}
                </span>
              </td>
              <td className="py-3 px-4">
                <div className="flex items-center gap-1">
                  <button onClick={(e) => { e.stopPropagation(); onDelete(jd.id); }}
                    className="p-1.5 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-500 transition-all opacity-0 group-hover:opacity-100"
                    title="删除岗位">
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <ChevronRight className={cn('w-4 h-4 transition-all', selectedId === jd.id ? 'text-indigo-500 rotate-90' : 'text-gray-300')} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
