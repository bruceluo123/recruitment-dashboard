'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Loader2, RefreshCw, Copy, Check } from 'lucide-react';
import type { RepushColumnId, RepushItem } from '@/store/repush-store';
import type { Candidate } from '@/types/interview';
import {
  todaysRecommendations,
  todaysInterviews,
  aggregateRecommendations,
  isInterviewPassed,
} from '@/lib/daily-report';
import { generateTodayReport, type TodayReportInput } from '@/lib/daily-report-text';

interface TodayReportModalProps {
  column: RepushColumnId;   // 当前推荐人列
  name: string;             // 录入人名（如「麦满分」）
  items: RepushItem[];      // 全部推荐记录
  candidates: Candidate[];  // 全部面试候选人
  onClose: () => void;
}

/** 今日日报：依据今日简历/面试数据，AI 按真人模板自由生成一份每日不重样的文字日报。 */
export function TodayReportModal({ column, name, items, candidates, onClose }: TodayReportModalProps) {
  const ref = useMemo(() => new Date(), []);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const input: TodayReportInput = useMemo(() => {
    const recs = todaysRecommendations(items, ref, column);
    const recommendDetail = aggregateRecommendations(recs);
    const interviews = todaysInterviews(candidates, ref).map((c) => ({
      job: c.jdTitle,
      person: c.name,
      status: c.stage === 'offer' ? '已通过' : '待反馈',
    }));
    return { name, date: ref, recommendDetail, interviews };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    try {
      const out = await generateTodayReport(input, ctrl.signal);
      if (!ctrl.signal.aborted) setText(out);
    } catch {
      /* aborted */
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  };

  useEffect(() => {
    run();
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
            依据今日数据自动生成（收取/推荐 {input.recommendDetail.length} 类岗位 · 面试 {input.interviews.length} 场，通过 {passCount}）。每次生成内容都会有变化，可手动修改后复制。
          </div>
          {loading ? (
            <div className="flex items-center justify-center gap-2 text-gray-400 py-16">
              <Loader2 className="w-5 h-5 animate-spin" />AI 正在撰写今日日报…
            </div>
          ) : (
            <textarea
              className="w-full h-72 px-3 py-2 rounded-xl border border-gray-200 text-sm leading-relaxed resize-none focus:outline-none focus:border-emerald-300"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          )}
        </div>

        <div className="px-5 py-4 border-t border-gray-100 flex items-center justify-end gap-2">
          <button
            onClick={run}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 h-9 rounded-xl border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-50 disabled:opacity-60"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />重新生成
          </button>
          <button
            onClick={handleCopy}
            disabled={loading || !text.trim()}
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
