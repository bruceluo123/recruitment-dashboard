'use client';

import { useEffect, useState } from 'react';
import { Check, Copy, FileText, X } from 'lucide-react';
import { useEscapeClose } from '@/hooks/useEscapeClose';
import { cn } from '@/lib/utils';

export interface RecommendationCopyItem {
  jdId: string;
  title: string;
  organization: string;
  contactPerson: string;
  text: string;
}

interface RecommendationCopyDialogProps {
  items: RecommendationCopyItem[];
  initialJdId?: string;
  onClose: () => void;
}

export function RecommendationCopyDialog({ items, initialJdId, onClose }: RecommendationCopyDialogProps) {
  const [activeJdId, setActiveJdId] = useState(initialJdId || items[0]?.jdId || '');
  const [copiedJdId, setCopiedJdId] = useState('');
  useEscapeClose(onClose);

  useEffect(() => {
    setActiveJdId(initialJdId || items[0]?.jdId || '');
  }, [initialJdId, items]);

  const activeItem = items.find((item) => item.jdId === activeJdId) || items[0];
  if (!activeItem) return null;

  const copyCurrent = async () => {
    try {
      await navigator.clipboard.writeText(activeItem.text);
      setCopiedJdId(activeItem.jdId);
      setTimeout(() => setCopiedJdId(''), 1600);
    } catch {
      setCopiedJdId('');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="岗位推荐文案"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[86vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h3 className="flex items-center gap-2 text-base font-semibold text-slate-900">
              <FileText className="h-5 w-5 text-indigo-500" />
              推荐文案
              <span className="rounded-md bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-600">
                {items.length} 个岗位
              </span>
            </h3>
            <p className="mt-1 text-xs text-slate-400">每个岗位独立一份，选择左侧岗位后单独复制。</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            aria-label="关闭"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto md:grid-cols-[240px_minmax(0,1fr)] md:overflow-hidden">
          <div className="border-b border-slate-100 bg-slate-50/70 p-3 md:overflow-y-auto md:border-b-0 md:border-r">
            <p className="mb-2 px-2 text-xs font-medium text-slate-400">已生成岗位</p>
            <div className="flex gap-2 overflow-x-auto pb-1 md:block md:space-y-1 md:overflow-visible md:pb-0">
              {items.map((item) => (
                <button
                  type="button"
                  key={item.jdId}
                  onClick={() => setActiveJdId(item.jdId)}
                  className={cn(
                    'min-w-[210px] rounded-lg border px-3 py-2.5 text-left transition-colors md:min-w-0 md:w-full',
                    activeItem.jdId === item.jdId
                      ? 'border-indigo-200 bg-white text-slate-900 shadow-sm'
                      : 'border-transparent text-slate-600 hover:bg-white',
                  )}
                >
                  <span className="block truncate text-sm font-medium">{item.title}</span>
                  <span className="mt-1 block truncate text-xs text-slate-400">{item.organization || '未填写服务单位'}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex min-h-0 flex-col p-5">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h4 className="truncate text-base font-semibold text-slate-900">{activeItem.title}</h4>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
                  <span>服务单位：{activeItem.organization || '未填写'}</span>
                  <span>对接 BP：{activeItem.contactPerson || '未填写'}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={copyCurrent}
                className={cn(
                  'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3.5 text-sm font-medium transition-colors',
                  copiedJdId === activeItem.jdId
                    ? 'bg-emerald-50 text-emerald-600'
                    : 'bg-indigo-600 text-white hover:bg-indigo-700',
                )}
              >
                {copiedJdId === activeItem.jdId
                  ? <><Check className="h-4 w-4" />已复制</>
                  : <><Copy className="h-4 w-4" />复制当前文案</>}
              </button>
            </div>
            <textarea
              readOnly
              value={activeItem.text}
              onFocus={(event) => event.currentTarget.select()}
              className="min-h-[330px] flex-1 resize-none rounded-lg border border-slate-200 bg-slate-50/60 p-4 text-sm leading-7 text-slate-700 outline-none focus:border-indigo-300 focus:bg-white focus:ring-2 focus:ring-indigo-100 md:min-h-[390px]"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
