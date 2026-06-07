'use client';
import { useState } from 'react';
import { CalendarPlus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { RepushItem, InterviewRound } from '@/store/repush-store';

interface ScheduleModalProps {
  item: RepushItem;
  onClose: () => void;
  onConfirm: (args: { interviewAt: string; interviewer: string; round: InterviewRound }) => void;
}

const ROUNDS: InterviewRound[] = ['一面', '二面', '三面'];

/** 默认时间：今天 14:00 的 datetime-local 字符串 */
function defaultLocalTime(): string {
  const d = new Date();
  d.setHours(14, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ScheduleModal({ item, onClose, onConfirm }: ScheduleModalProps) {
  const [interviewAt, setInterviewAt] = useState(item.interviewAt
    ? toLocal(item.interviewAt)
    : defaultLocalTime());
  const [interviewer, setInterviewer] = useState('');
  const [round, setRound] = useState<InterviewRound>(item.interviewRound || '一面');

  const base = item.candidateName || item.fileName.replace(/\.(pdf|docx?)$/i, '');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white border border-gray-200 rounded-2xl shadow-2xl p-6 animate-fade-in">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-gray-800 flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-indigo-500 flex items-center justify-center"><CalendarPlus className="w-4 h-4 text-white" /></span>
            约面
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100" title="关闭"><X className="w-4 h-4" /></button>
        </div>

        <p className="text-sm text-gray-500 mb-4">
          候选人：<span className="font-medium text-gray-800">{base}</span>
          {item.jdTitle ? <span className="text-gray-400"> · {item.jdTitle}</span> : null}
        </p>

        <div className="space-y-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1.5">面试轮次</label>
            <div className="flex gap-2">
              {ROUNDS.map((r) => (
                <button
                  key={r}
                  onClick={() => setRound(r)}
                  className={cn(
                    'flex-1 h-9 rounded-xl text-sm font-medium border transition-all',
                    round === r ? 'border-indigo-500 bg-indigo-500 text-white' : 'border-gray-200 text-gray-500 hover:border-indigo-300',
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">面试时间 *</label>
            <input
              type="datetime-local"
              value={interviewAt}
              onChange={(e) => setInterviewAt(e.target.value)}
              className="w-full h-10 px-3 rounded-xl bg-white border border-gray-200 text-sm outline-none focus:border-indigo-300"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">面试官</label>
            <input
              value={interviewer}
              onChange={(e) => setInterviewer(e.target.value)}
              placeholder="选填"
              className="w-full h-10 px-3 rounded-xl bg-white border border-gray-200 text-sm outline-none focus:border-indigo-300"
            />
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="h-10 px-4 rounded-xl text-sm font-medium text-gray-500 hover:bg-gray-100">取消</button>
          <button
            onClick={() => onConfirm({ interviewAt, interviewer, round })}
            disabled={!interviewAt}
            className={cn(
              'h-10 px-5 rounded-xl text-sm font-medium text-white transition-colors',
              interviewAt ? 'bg-indigo-500 hover:bg-indigo-600' : 'bg-gray-200 cursor-not-allowed',
            )}
          >
            确认约面
          </button>
        </div>
      </div>
    </div>
  );
}

/** ISO → datetime-local（本地时区） */
function toLocal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
