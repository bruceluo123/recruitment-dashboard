'use client';
import { useMemo, useState } from 'react';
import { Check, Copy, X } from 'lucide-react';
import { useEscapeClose } from '@/hooks/useEscapeClose';
import { buildWeeklyReport } from '@/lib/weekly-report-text';
import type { RepushColumnId, RepushItem } from '@/store/repush-store';
import type { Candidate } from '@/types/interview';
import type { JD } from '@/types/jd';

interface WeeklyReportModalProps {
  column: RepushColumnId;
  name: string;
  items: RepushItem[];
  candidates: Candidate[];
  jds: JD[];
  onClose: () => void;
}

function monthDay(value: Date): string {
  return `${value.getMonth() + 1}.${value.getDate()}`;
}

export function WeeklyReportModal({ column, name, items, candidates, jds, onClose }: WeeklyReportModalProps) {
  const report = useMemo(
    () => buildWeeklyReport({ column, name, items, candidates, jds }),
    [column, name, items, candidates, jds],
  );
  const [text, setText] = useState(report.text);
  const [copied, setCopied] = useState(false);
  useEscapeClose(onClose);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* 浏览器拒绝剪贴板权限时保留可手动复制的文本框。 */ }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <h3 className="text-base font-semibold text-gray-800">
            周报 · <span className="text-indigo-600">{name}</span>
            <span className="ml-2 text-sm font-normal text-gray-400">
              {monthDay(report.start)}-{monthDay(report.end)}
            </span>
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="关闭周报">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          <div className="text-xs leading-5 text-gray-400">
            周一至周六 · 推荐 {report.recommendationCount} 人 · 面试 {report.interviewCount} 人 · Offer {report.offerCount} 人 · 入职 {report.onboardCount} 人。推荐仅统计实际送达的首次推荐，复推不计入。
          </div>
          <textarea
            className="h-96 w-full resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm leading-relaxed focus:border-indigo-300 focus:outline-none"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-4">
          <button
            onClick={handleCopy}
            disabled={!text.trim()}
            className="flex h-9 items-center gap-1.5 rounded-xl bg-indigo-500 px-4 text-sm font-medium text-white hover:bg-indigo-600 disabled:opacity-60"
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? '已复制' : '复制周报'}
          </button>
        </div>
      </div>
    </div>
  );
}
