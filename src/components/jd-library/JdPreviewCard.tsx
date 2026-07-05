'use client';
import type { JD } from '@/types/jd';
import { JD_CATEGORY_LABELS, JD_CATEGORY_COLORS } from '@/types/jd';
import { X } from 'lucide-react';

// JD 详情预览卡（左侧滑出）。原本在 ImportDiffDialog 与 WeeklyAddedDialog 中各复制一份，
// 抽成共用组件避免字段调整时漏改一处（历史上「今日增改与详情卡不一致」bug 即此类）。
interface JdPreviewCardProps { jd: JD; onClose: () => void; }

export function JdPreviewCard({ jd, onClose }: JdPreviewCardProps) {
  return (
    <div className="relative z-10 w-[360px] h-full bg-white border-r border-gray-100 shadow-xl flex flex-col overflow-hidden animate-fade-in">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`px-2 py-0.5 rounded-md text-xs font-medium shrink-0 ${JD_CATEGORY_COLORS[jd.categories[0]]}`}>
            {JD_CATEGORY_LABELS[jd.categories[0]]}
          </span>
          <h4 className="text-sm font-semibold text-gray-800 truncate">{jd.title}</h4>
        </div>
        <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400 shrink-0 ml-2">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="overflow-y-auto flex-1 px-4 py-3 space-y-4">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
          {jd.organization && <span>🏢 {jd.organization}</span>}
          {(jd.serviceUnit || jd.department) && <span>📍 {jd.serviceUnit || jd.department}</span>}
          {jd.headcount && <span>HC: <span className="font-medium text-gray-700">{jd.headcount}</span></span>}
          {jd.gap && jd.gap !== '0' && <span className="text-red-500 font-medium">缺口: {jd.gap}</span>}
          {(jd.salaryText || (jd.salaryRange.min > 0)) && (
            <span className="text-green-600 font-medium">
              {jd.salaryText || `${jd.salaryRange.min}K-${jd.salaryRange.max}K`}
            </span>
          )}
        </div>
        {jd.responsibilities.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">岗位职责</p>
            <ul className="space-y-1">
              {jd.responsibilities.map((r, i) => (
                <li key={i} className="text-xs text-gray-600 flex gap-1.5 leading-relaxed">
                  <span className="text-gray-300 shrink-0 mt-0.5">·</span><span>{r}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {jd.requirements.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">岗位要求</p>
            <ul className="space-y-1">
              {jd.requirements.map((r, i) => (
                <li key={i} className="text-xs text-gray-600 flex gap-1.5 leading-relaxed">
                  <span className="text-gray-300 shrink-0 mt-0.5">·</span><span>{r}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {jd.notes && (
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">备注说明</p>
            <p className="text-xs text-gray-600 leading-relaxed whitespace-pre-line">{jd.notes}</p>
          </div>
        )}
      </div>
    </div>
  );
}
