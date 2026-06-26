'use client';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { JD_CATEGORY_LABELS, JD_CATEGORY_COLORS } from '@/types/jd';
import type { Talent } from '@/types/talent';
import { Pencil, Trash2, Sparkles, X } from 'lucide-react';

interface TalentTableProps {
  talents: Talent[];
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  batchMode?: boolean;
  selectedIds?: string[];
  onToggleSelect?: (id: string) => void;
  onToggleSelectAll?: () => void;
}

/** 把人才结构化字段组装成亮点摘要行 */
function buildTalentHighlights(t: Talent): string {
  const lines: string[] = [];
  const expParts: string[] = [];
  if (t.company) expParts.push(`现任 ${t.company}`);
  if (t.jobTitle) expParts.push(t.jobTitle);
  if (expParts.length) lines.push(`💼 ${expParts.join(' · ')}`);
  if (t.prevCompanies?.length) lines.push(`🏢 曾任职：${t.prevCompanies.slice(0, 3).join(' / ')}`);
  const eduParts: string[] = [];
  if (t.school) eduParts.push(t.school);
  if (t.eduLevel) eduParts.push(t.eduLevel);
  if (t.major) eduParts.push(t.major);
  if (eduParts.length) lines.push(`🎓 ${eduParts.join(' · ')}`);
  if (t.techDirection) lines.push(`⚡ ${t.techDirection}`);
  if (t.level) lines.push(`🏷 ${t.level}`);
  if (t.location) lines.push(`📍 ${t.location}`);
  const salaryParts: string[] = [];
  if (t.monthlySalary) salaryParts.push(`月薪 ${t.monthlySalary}`);
  if (t.annualSalary) salaryParts.push(`年薪 ${t.annualSalary}`);
  if (salaryParts.length) lines.push(`💰 ${salaryParts.join(' · ')}`);
  if (t.workIntent) lines.push(`🎯 ${t.workIntent}`);
  if (t.notes) lines.push(`📝 ${t.notes.slice(0, 60)}${t.notes.length > 60 ? '…' : ''}`);
  return lines.join('\n');
}

function HighlightsModal({ talent, onClose }: { talent: Talent; onClose: () => void }) {
  const text = buildTalentHighlights(talent);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="fixed inset-0 bg-black/20" />
      <div
        className="relative w-full max-w-sm bg-white rounded-2xl shadow-xl border border-amber-100 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-amber-500" />
            {talent.name} · 简历亮点
          </h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400">
            <X className="w-4 h-4" />
          </button>
        </div>
        {text ? (
          <pre className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap font-sans">{text}</pre>
        ) : (
          <p className="text-sm text-gray-400">暂无结构化信息，请先充实档案。</p>
        )}
        {talent.resumeChars && (
          <p className="mt-3 text-xs text-gray-400">简历字数：{talent.resumeChars.toLocaleString()} 字</p>
        )}
      </div>
    </div>
  );
}

export function TalentTable({ talents, onEdit, onDelete, batchMode = false, selectedIds = [], onToggleSelect, onToggleSelectAll }: TalentTableProps) {
  const [highlightId, setHighlightId] = useState<string | null>(null);
  if (talents.length === 0) return <div className="text-center py-12 text-gray-400"><p>暂无匹配的人选</p></div>;

  const selectedSet = new Set(selectedIds);
  const allSelected = talents.length > 0 && talents.every((t) => selectedSet.has(t.id));
  const highlightTalent = talents.find((t) => t.id === highlightId) || null;

  return (
    <>
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
              <th className="w-28" />
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
                      {/* 亮点按钮：有简历文字时显示（橙色），有简历但未扫描时显示灰色 */}
                      {t.hasResumeText ? (
                        <button
                          onClick={() => setHighlightId(t.id)}
                          className="flex items-center gap-0.5 px-2 h-7 rounded-lg text-xs font-medium bg-amber-50 text-amber-500 border border-amber-200 hover:bg-amber-100 transition-colors shrink-0"
                          title="查看简历亮点"
                        >
                          <Sparkles className="w-3.5 h-3.5" />亮点
                        </button>
                      ) : t.resumeUrl ? (
                        <span className="flex items-center gap-0.5 px-2 h-7 rounded-lg text-xs text-gray-300 border border-gray-100 shrink-0" title="有简历但未扫描">
                          <Sparkles className="w-3.5 h-3.5" />简历
                        </span>
                      ) : null}
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

      {highlightTalent && (
        <HighlightsModal talent={highlightTalent} onClose={() => setHighlightId(null)} />
      )}
    </>
  );
}
