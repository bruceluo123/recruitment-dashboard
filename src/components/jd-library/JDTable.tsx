'use client';
import { useState } from 'react';
import { cn, formatSalary } from '@/lib/utils';
import { JD_CATEGORY_LABELS, JD_CATEGORY_COLORS, PRIORITY_COLORS, isUrgentPriority, type JD } from '@/types/jd';
import { ChevronRight, Trash2, Copy, Check } from 'lucide-react';
import { ColumnFilter } from '@/components/ui/ColumnFilter';

interface JDTableProps {
  jds: JD[];
  onSelect: (id: string) => void;
  selectedId: string | null;
  onDelete: (id: string) => void;
  batchMode?: boolean;
  selectedIds?: string[];
  onToggleSelect?: (id: string) => void;
  onToggleSelectAll?: () => void;
  orgOptions?: string[];
  serviceOptions?: string[];
  orgFilter?: Set<string>;
  serviceFilter?: Set<string>;
  onOrgFilterChange?: (next: Set<string>) => void;
  onServiceFilterChange?: (next: Set<string>) => void;
}

export function JDTable({
  jds, onSelect, selectedId, onDelete, batchMode = false, selectedIds = [], onToggleSelect, onToggleSelectAll,
  orgOptions = [], serviceOptions = [], orgFilter, serviceFilter, onOrgFilterChange, onServiceFilterChange,
}: JDTableProps) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const copyText = async (key: string, text: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500);
    } catch { /* clipboard 不可用时忽略 */ }
  };

  if (jds.length === 0) return <div className="text-center py-12 text-gray-400"><p>暂无匹配的岗位</p></div>;

  const selectedSet = new Set(selectedIds);
  const allSelected = jds.length > 0 && jds.every((jd) => selectedSet.has(jd.id));

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1040px] table-fixed">
        <colgroup>
          {batchMode && <col className="w-10" />}
          <col className="w-[200px]" />
          <col className="w-[72px]" />
          <col className="w-[56px]" />
          <col className="w-[56px]" />
          <col className="w-[120px]" />
          <col className="w-[120px]" />
          <col className="w-[190px]" />
          <col className="w-[110px]" />
          <col className="w-[88px]" />
          <col className="w-12" />
        </colgroup>
        <thead>
          <tr className="border-b border-gray-100">
            {batchMode && (
              <th className="py-3 px-4">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={onToggleSelectAll}
                  className="w-4 h-4 rounded border-gray-300 text-indigo-500 focus:ring-indigo-200"
                  aria-label="全选当前列表"
                />
              </th>
            )}
            <th className="text-left py-3 px-4 text-xs font-medium text-gray-400 uppercase tracking-wider whitespace-nowrap">岗位名称</th>
            <th className="text-left py-3 px-2 text-xs font-medium text-gray-400 uppercase tracking-wider whitespace-nowrap">分类</th>
            <th className="text-center py-3 px-2 text-xs font-medium text-gray-400 uppercase tracking-wider whitespace-nowrap">HC</th>
            <th className="text-center py-3 px-2 text-xs font-medium text-gray-400 uppercase tracking-wider whitespace-nowrap">缺口</th>
            <th className="text-left py-3 px-4 text-xs font-medium text-gray-400 uppercase tracking-wider whitespace-nowrap">
              {onOrgFilterChange
                ? <ColumnFilter label="编制组织" options={orgOptions} selected={orgFilter ?? new Set()} onChange={onOrgFilterChange} />
                : '编制组织'}
            </th>
            <th className="text-left py-3 px-4 text-xs font-medium text-gray-400 uppercase tracking-wider whitespace-nowrap">
              {onServiceFilterChange
                ? <ColumnFilter label="服务单位" options={serviceOptions} selected={serviceFilter ?? new Set()} onChange={onServiceFilterChange} />
                : '服务单位'}
            </th>
            <th className="text-left py-3 px-4 text-xs font-medium text-gray-400 uppercase tracking-wider whitespace-nowrap">对接ODC</th>
            <th className="text-left py-3 px-4 text-xs font-medium text-gray-400 uppercase tracking-wider whitespace-nowrap">薪资</th>
            <th className="text-left py-3 px-4 text-xs font-medium text-gray-400 uppercase tracking-wider whitespace-nowrap">状态</th>
            <th className="w-12" />
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
                <div className="flex items-center gap-2 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{jd.title}</p>
                  {isUrgentPriority(jd.priority) && (
                    <span className={cn('px-1.5 py-0.5 rounded-md text-xs font-bold shrink-0', PRIORITY_COLORS[jd.priority!])}>{jd.priority}</span>
                  )}
                </div>
              </td>
              <td className={cn('py-3 px-2', !batchMode && 'cursor-pointer')} onClick={() => batchMode ? onToggleSelect?.(jd.id) : onSelect(jd.id)}>
                <span className={cn('inline-block px-2 py-0.5 rounded-md text-xs font-medium whitespace-nowrap', JD_CATEGORY_COLORS[jd.categories[0]])}>{JD_CATEGORY_LABELS[jd.categories[0]]}</span>
              </td>
              <td className={cn('py-3 px-2 text-center w-14', !batchMode && 'cursor-pointer')} onClick={() => batchMode ? onToggleSelect?.(jd.id) : onSelect(jd.id)}>
                <span className="text-sm font-medium text-gray-700">{jd.headcount || '-'}</span>
              </td>
              <td className={cn('py-3 px-2 text-center w-14', !batchMode && 'cursor-pointer')} onClick={() => batchMode ? onToggleSelect?.(jd.id) : onSelect(jd.id)}>
                <span className={cn('text-sm font-medium', jd.gap && jd.gap !== '0' ? 'text-red-500' : 'text-gray-400')}>{jd.gap || '-'}</span>
              </td>
              {(() => {
                const orgServiceText = [jd.organization, jd.serviceUnit].filter(Boolean).join(' ');
                const orgKey = `${jd.id}-org`;
                const renderOrgService = (label: string) => orgServiceText ? (
                  <button onClick={(e) => { e.stopPropagation(); copyText(orgKey, orgServiceText); }}
                    title={`点击复制：${orgServiceText}`}
                    className="group/cp inline-flex items-center gap-1 text-sm text-gray-500 hover:text-indigo-600 transition-colors max-w-full">
                    <span className="truncate">{label}</span>
                    {copiedKey === orgKey
                      ? <Check className="w-3 h-3 text-green-600 shrink-0" />
                      : <Copy className="w-3 h-3 shrink-0 opacity-0 group-hover/cp:opacity-100 transition-opacity" />}
                  </button>
                ) : <span className="text-sm text-gray-400">-</span>;
                const odcKey = `${jd.id}-odc`;
                return (
                  <>
                    <td className="py-3 px-4">{renderOrgService(jd.organization || '-')}</td>
                    <td className="py-3 px-4">{renderOrgService(jd.serviceUnit || jd.department || '-')}</td>
                    <td className="py-3 px-4">
                      {jd.odc ? (
                        <button onClick={(e) => { e.stopPropagation(); copyText(odcKey, jd.odc!); }}
                          title={`点击复制：${jd.odc}`}
                          className="group/cp inline-flex items-center gap-1 text-sm text-gray-500 hover:text-indigo-600 transition-colors max-w-full">
                          <span className="truncate">{jd.odc}</span>
                          {copiedKey === odcKey
                            ? <Check className="w-3 h-3 text-green-600 shrink-0" />
                            : <Copy className="w-3 h-3 shrink-0 opacity-0 group-hover/cp:opacity-100 transition-opacity" />}
                        </button>
                      ) : <span className="text-sm text-gray-400">-</span>}
                    </td>
                  </>
                );
              })()}
              <td className={cn('py-3 px-4', !batchMode && 'cursor-pointer')} onClick={() => batchMode ? onToggleSelect?.(jd.id) : onSelect(jd.id)}>
                <span className="text-sm text-green-600 font-medium whitespace-nowrap">{jd.salaryText || (jd.salaryRange.min ? formatSalary(jd.salaryRange) : '-')}</span>
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
                      {confirmingId === jd.id ? (
                        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          <button onClick={() => { onDelete(jd.id); setConfirmingId(null); }}
                            className="px-2 h-7 rounded-lg text-xs font-medium bg-red-500 text-white hover:bg-red-600">确认删除</button>
                          <button onClick={() => setConfirmingId(null)}
                            className="px-2 h-7 rounded-lg text-xs text-gray-500 hover:bg-gray-100">取消</button>
                        </div>
                      ) : (
                        <button onClick={(e) => { e.stopPropagation(); setConfirmingId(jd.id); }}
                          className="p-1.5 rounded-lg hover:bg-red-50 text-gray-300 hover:text-red-500 transition-all opacity-0 group-hover:opacity-100"
                          title="删除岗位">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
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
