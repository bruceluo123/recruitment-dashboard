'use client';
import { useState } from 'react';
import type { JD } from '@/types/jd';
import { JD_CATEGORY_LABELS, JD_CATEGORY_COLORS } from '@/types/jd';
import { formatSalary } from '@/lib/utils';
import { sanitizeJDSalaryText } from '@/lib/jd-parse-core';
import { Check, Copy, X } from 'lucide-react';

// JD 详情预览卡（左侧滑出）。原本在 ImportDiffDialog 与 WeeklyAddedDialog 中各复制一份，
// 抽成共用组件避免字段调整时漏改一处（历史上「今日增改与详情卡不一致」bug 即此类）。
interface JdPreviewCardProps { jd: JD; onClose: () => void; }

export function JdPreviewCard({ jd, onClose }: JdPreviewCardProps) {
  const [copied, setCopied] = useState(false);
  const salaryText = sanitizeJDSalaryText(jd.salaryText);

  const handleCopy = async () => {
    const salary = salaryText || (jd.salaryRange.min ? formatSalary(jd.salaryRange) : '');
    const sections = [
      jd.responsibilities.length
        ? `岗位职责：\n${jd.responsibilities.map((item, index) => `${index + 1}. ${item}`).join('\n')}`
        : '',
      jd.requirements.length
        ? `任职要求：\n${jd.requirements.map((item, index) => `${index + 1}. ${item}`).join('\n')}`
        : '',
    ].filter(Boolean);
    const text = `${jd.title}${salary ? `\n薪资：${salary}` : ''}${sections.length ? `\n\n${sections.join('\n\n')}` : ''}`;

    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="relative z-10 w-[360px] h-full bg-white border-r border-gray-100 shadow-xl flex flex-col overflow-hidden animate-fade-in">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`px-2 py-0.5 rounded-md text-xs font-medium shrink-0 ${JD_CATEGORY_COLORS[jd.categories[0]]}`}>
            {JD_CATEGORY_LABELS[jd.categories[0]]}
          </span>
          <h4 className="text-sm font-semibold text-gray-800 truncate">{jd.title}</h4>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 ml-2">
          <button
            onClick={handleCopy}
            className={`h-7 px-2.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${
              copied
                ? 'bg-green-50 text-green-600 border border-green-200'
                : 'bg-indigo-50 text-indigo-600 border border-indigo-100 hover:bg-indigo-100'
            }`}
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? '已复制' : '复制 JD'}
          </button>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 text-gray-400">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div className="overflow-y-auto flex-1 px-4 py-3 space-y-4">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
          {jd.organization && <span>🏢 {jd.organization}</span>}
          {(jd.serviceUnit || jd.department) && <span>📍 {jd.serviceUnit || jd.department}</span>}
          {jd.headcount && <span>HC: <span className="font-medium text-gray-700">{jd.headcount}</span></span>}
          {jd.gap && jd.gap !== '0' && <span className="text-red-500 font-medium">缺口: {jd.gap}</span>}
          {(salaryText || (jd.salaryRange.min > 0)) && (
            <span className="text-green-600 font-medium">
              {salaryText || `${jd.salaryRange.min}K-${jd.salaryRange.max}K`}
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
