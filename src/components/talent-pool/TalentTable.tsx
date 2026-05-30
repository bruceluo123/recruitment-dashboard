'use client';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { useTalentStore } from '@/store/talent-store';
import { JD_CATEGORY_LABELS, JD_CATEGORY_COLORS } from '@/types/jd';
import type { Talent } from '@/types/talent';
import { FileText, Pencil, Copy, Check, Trash2, X } from 'lucide-react';

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
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editingTgId, setEditingTgId] = useState<string | null>(null);
  const [tgDraft, setTgDraft] = useState('');
  const updateTalent = useTalentStore((s) => s.updateTalent);
  if (talents.length === 0) return <div className="text-center py-12 text-gray-400"><p>暂无匹配的人选</p></div>;

  const selectedSet = new Set(selectedIds);
  const allSelected = talents.length > 0 && talents.every((t) => selectedSet.has(t.id));

  const handleCopyTg = async (talent: Talent) => {
    if (!talent.tg) return;
    try {
      await navigator.clipboard.writeText(talent.tg);
      setCopiedId(talent.id);
      setTimeout(() => setCopiedId((cur) => (cur === talent.id ? null : cur)), 1500);
    } catch { /* clipboard 不可用时忽略 */ }
  };

  const startEditTg = (talent: Talent) => {
    setEditingTgId(talent.id);
    setTgDraft(talent.tg || '');
  };

  const saveTg = (id: string) => {
    updateTalent(id, { tg: tgDraft.trim() });
    setEditingTgId(null);
    setTgDraft('');
  };

  const cancelEditTg = () => {
    setEditingTgId(null);
    setTgDraft('');
  };

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
            <th className="text-left py-3 px-4 text-xs font-medium text-gray-400 uppercase tracking-wider">岗位名称</th>
            <th className="text-left py-3 px-4 text-xs font-medium text-gray-400 uppercase tracking-wider">简历链接</th>
            <th className="text-left py-3 px-4 text-xs font-medium text-gray-400 uppercase tracking-wider">TG 号</th>
            <th className="text-left py-3 px-4 text-xs font-medium text-gray-400 uppercase tracking-wider">备注</th>
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
              <td className="py-3 px-4"><p className="text-sm font-medium text-gray-800">{t.name || '-'}</p></td>
              <td className="py-3 px-4">
                {(t.categories || []).slice(0, 2).map((cat) => (
                  <span key={cat} className={cn('px-2 py-0.5 rounded-md text-xs font-medium mr-1', JD_CATEGORY_COLORS[cat])}>{JD_CATEGORY_LABELS[cat]}</span>
                ))}
              </td>
              <td className="py-3 px-4"><p className="text-sm text-gray-600 truncate max-w-[200px]">{t.jobTitle || '-'}</p></td>
              <td className="py-3 px-4">
                {t.resumeUrl ? (
                  <a href={t.resumeUrl} target="_blank" rel="noopener noreferrer" download={t.resumeFileName}
                    className="inline-flex items-center gap-1.5 text-sm text-indigo-600 hover:text-indigo-700 hover:underline max-w-[200px]">
                    <FileText className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{t.resumeFileName || '简历'}</span>
                  </a>
                ) : <span className="text-sm text-gray-300">-</span>}
              </td>
              <td className="py-3 px-4">
                {editingTgId === t.id ? (
                  <div className="inline-flex items-center gap-1">
                    <input autoFocus value={tgDraft} onChange={(e) => setTgDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') saveTg(t.id); if (e.key === 'Escape') cancelEditTg(); }}
                      placeholder="@username"
                      className="h-7 w-32 px-2 rounded-md border border-indigo-300 text-sm focus:outline-none focus:border-indigo-400" />
                    <button onClick={() => saveTg(t.id)} title="保存" className="p-1 rounded text-green-500 hover:bg-green-50"><Check className="w-3.5 h-3.5" /></button>
                    <button onClick={cancelEditTg} title="取消" className="p-1 rounded text-gray-400 hover:bg-gray-100"><X className="w-3.5 h-3.5" /></button>
                  </div>
                ) : (
                  <div className="inline-flex items-center gap-1.5">
                    {t.tg ? (
                      <button onClick={() => handleCopyTg(t)} title="点击复制到剪贴板"
                        className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-indigo-600 transition-colors">
                        {copiedId === t.id ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5 text-gray-300 group-hover:text-gray-400" />}
                        <span>{t.tg}</span>
                      </button>
                    ) : <span className="text-sm text-gray-300">-</span>}
                    <button onClick={() => startEditTg(t)} title="编辑 TG 号"
                      className="p-1 rounded text-gray-300 hover:text-indigo-500 hover:bg-indigo-50 transition-all opacity-0 group-hover:opacity-100">
                      <Pencil className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </td>
              <td className="py-3 px-4"><p className="text-sm text-gray-500 truncate max-w-[160px]">{t.notes || '-'}</p></td>
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
