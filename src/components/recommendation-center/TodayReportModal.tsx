'use client';
import { useMemo, useState } from 'react';
import { X, Copy, Check } from 'lucide-react';
import type { RepushColumnId, RepushItem } from '@/store/repush-store';
import type { Candidate } from '@/types/interview';
import {
  todaysRecommendations,
  todaysInterviews,
  aggregateRecommendations,
  isInterviewPassed,
} from '@/lib/daily-report';
import { buildTodayReportTemplate, type TodayReportInput } from '@/lib/daily-report-text';

interface TodayReportModalProps {
  column: RepushColumnId;   // 当前推荐人列
  name: string;             // 录入人名（如「麦满分」）
  items: RepushItem[];      // 全部推荐记录
  candidates: Candidate[];  // 全部面试候选人
  onClose: () => void;
}

/** 今日日报：按真人模板直接套用今日数据生成文字日报，改日期/微调后即可复制（不调用 AI）。 */
export function TodayReportModal({ column, name, items, candidates, onClose }: TodayReportModalProps) {
  const ref = useMemo(() => new Date(), []);
  const [copied, setCopied] = useState(false);

  const input: TodayReportInput = useMemo(() => {
    const recs = todaysRecommendations(items, ref, column);
    const recommendDetail = aggregateRecommendations(recs);
    const interviews = todaysInterviews(candidates, ref, column).map((c) => ({
      job: c.jdTitle,
      person: c.name,
      status: c.stage === 'offer' ? '已通过' : '待反馈',
    }));
    return { name, date: ref, recommendDetail, interviews };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [text, setText] = useState(() => buildTodayReportTemplate(input));

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  };

  const passCount = input.interviews.filter((v) => isInterviewPassed(v.status)).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl max-h-[88vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="text-base font-semibold text-gray-800">
            今日日报 · <span className="text-emerald-600">{name}</span>
            <span className="ml-2 text-sm font-normal text-gray-400">
              {ref.getMonth() + 1}.{ref.getDate()}
            </span>
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          <div className="text-xs text-gray-400">
            按模板套用今日数据（收取/推荐 {input.recommendDetail.length} 类岗位 · 面试 {input.interviews.length} 场，通过 {passCount}）。改一下日期或微调后即可复制。
          </div>
          <textarea
            className="w-full h-72 px-3 py-2 rounded-xl border border-gray-200 text-sm leading-relaxed resize-none focus:outline-none focus:border-emerald-300"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>

        <div className="px-5 py-4 border-t border-gray-100 flex items-center justify-end gap-2">
          <button
            onClick={handleCopy}
            disabled={!text.trim()}
            className="flex items-center gap-1.5 px-4 h-9 rounded-xl bg-emerald-500 text-white text-sm font-medium hover:bg-emerald-600 disabled:opacity-60"
          >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            {copied ? '已复制' : '复制日报'}
          </button>
        </div>
      </div>
    </div>
  );
}
