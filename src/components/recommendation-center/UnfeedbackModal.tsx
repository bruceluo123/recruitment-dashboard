'use client';

import { useMemo, useState } from 'react';
import { Check, Clock3, Copy, X } from 'lucide-react';
import { useEscapeClose } from '@/hooks/useEscapeClose';
import { displayName } from '@/lib/repush-format';
import { cn } from '@/lib/utils';
import type { RepushItem } from '@/store/repush-store';

interface UnfeedbackModalProps {
  ownerName: string;
  items: RepushItem[];
  onClose: () => void;
}

const WEEKDAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'];

function localDayKey(date: Date): string {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

function candidateName(item: RepushItem): string {
  if (item.candidateName?.trim()) return item.candidateName.trim();
  const base = displayName(item);
  const job = item.jdTitle?.trim();
  if (job && base.includes(job)) return base.slice(0, base.lastIndexOf(job)).replace(/[-_\s]+$/, '').trim();
  return base;
}

export function UnfeedbackModal({ ownerName, items, onClose }: UnfeedbackModalProps) {
  useEscapeClose(onClose);

  const today = useMemo(() => {
    const value = new Date();
    value.setHours(0, 0, 0, 0);
    return value;
  }, []);
  const weekDays = useMemo(() => {
    const monday = new Date(today);
    monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(monday);
      date.setDate(monday.getDate() + index);
      return {
        key: localDayKey(date),
        date,
        label: `周${WEEKDAY_NAMES[date.getDay()]}`,
        shortDate: `${date.getMonth() + 1}/${date.getDate()}`,
        future: date.getTime() > today.getTime(),
      };
    });
  }, [today]);

  const itemsByDay = useMemo(() => {
    const result = new Map<string, RepushItem[]>();
    for (const item of items) {
      const date = new Date(item.uploadedAt);
      if (Number.isNaN(date.getTime())) continue;
      const key = localDayKey(date);
      const matches = result.get(key) || [];
      matches.push(item);
      result.set(key, matches);
    }
    result.forEach((matches) => {
      matches.sort((a, b) => new Date(a.uploadedAt).getTime() - new Date(b.uploadedAt).getTime());
    });
    return result;
  }, [items]);

  const defaultSelectedDays = useMemo(
    () => weekDays.filter((day) => !day.future && (itemsByDay.get(day.key)?.length || 0) > 0).map((day) => day.key),
    [itemsByDay, weekDays],
  );
  const [selectedDays, setSelectedDays] = useState<Set<string>>(() => new Set(defaultSelectedDays));
  const [copied, setCopied] = useState(false);

  const selectedItems = weekDays.reduce((total, day) => (
    selectedDays.has(day.key) ? total + (itemsByDay.get(day.key)?.length || 0) : total
  ), 0);

  const text = useMemo(() => {
    const sections = weekDays.flatMap((day) => {
      if (!selectedDays.has(day.key)) return [];
      const dayItems = itemsByDay.get(day.key) || [];
      if (dayItems.length === 0) return [];
      return [[
        `${day.date.getMonth() + 1}月${day.date.getDate()}日（${day.label}）推荐：`,
        ...dayItems.map((item, index) => `${index + 1}、${candidateName(item)}、${item.jdTitle?.trim() || '未填写岗位'}`),
      ].join('\n')];
    });
    if (sections.length === 0) return '';
    return [`${ownerName}本周未反馈岗位`, ...sections].join('\n\n');
  }, [itemsByDay, ownerName, selectedDays, weekDays]);

  const toggleDay = (key: string) => {
    setCopied(false);
    setSelectedDays((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const copyText = async () => {
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 p-3" role="dialog" aria-modal="true" aria-label="未反馈清单">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <header className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h3 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
              <Clock3 className="h-5 w-5 text-amber-500" />未反馈清单
            </h3>
            <p className="mt-1 text-sm text-slate-500">{ownerName} · 选择本周日期后复制对应的未反馈岗位</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600" title="关闭">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-medium text-slate-500">选择日期（可多选）</span>
            <div className="flex items-center gap-3 text-xs">
              <button type="button" onClick={() => setSelectedDays(new Set(defaultSelectedDays))} className="text-indigo-500 hover:text-indigo-700">本周全选</button>
              <button type="button" onClick={() => setSelectedDays(new Set())} className="text-slate-400 hover:text-slate-600">清空</button>
            </div>
          </div>

          <div className="mt-2.5 grid grid-cols-4 gap-2 sm:grid-cols-7">
            {weekDays.map((day) => {
              const count = itemsByDay.get(day.key)?.length || 0;
              const selected = selectedDays.has(day.key);
              return (
                <button
                  key={day.key}
                  type="button"
                  disabled={day.future}
                  onClick={() => toggleDay(day.key)}
                  className={cn(
                    'relative flex min-h-16 flex-col items-center justify-center rounded-xl border text-sm transition',
                    selected
                      ? 'border-amber-300 bg-amber-50 font-semibold text-amber-700 shadow-sm'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-amber-200 hover:bg-amber-50/50',
                    day.future && 'cursor-not-allowed bg-slate-50 text-slate-300 hover:border-slate-200 hover:bg-slate-50',
                  )}
                >
                  <span>{day.label}</span>
                  <span className="mt-0.5 text-[11px] font-normal opacity-70">{day.shortDate}</span>
                  {count > 0 && <span className="absolute right-1.5 top-1.5 rounded-full bg-white px-1.5 text-[10px] font-semibold text-amber-600 shadow-sm">{count}</span>}
                </button>
              );
            })}
          </div>

          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500">复制预览</span>
              <span className="text-xs text-slate-400">共 {selectedItems} 个岗位</span>
            </div>
            <div className="min-h-64 whitespace-pre-wrap rounded-xl border border-slate-200 bg-slate-50/80 p-4 text-sm leading-7 text-slate-700">
              {text || '所选日期暂无未反馈岗位'}
            </div>
          </div>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-slate-100 bg-white px-5 py-4">
          <button type="button" onClick={onClose} className="h-10 rounded-lg px-4 text-sm font-medium text-slate-500 hover:bg-slate-100">取消</button>
          <button
            type="button"
            onClick={() => void copyText()}
            disabled={!text}
            className="inline-flex h-10 min-w-28 items-center justify-center gap-1.5 rounded-lg bg-amber-500 px-4 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? '已复制' : '复制清单'}
          </button>
        </footer>
      </div>
    </div>
  );
}
