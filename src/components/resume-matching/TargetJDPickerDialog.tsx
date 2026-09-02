'use client';

import { useEffect, useMemo, useState } from 'react';
import { BriefcaseBusiness, Check, Search, X } from 'lucide-react';
import type { JD, JDCategory } from '@/types/jd';
import { hasCategory, JD_CATEGORY_LABELS } from '@/types/jd';
import { cn } from '@/lib/utils';

interface TargetJDPickerDialogProps {
  jds: JD[];
  selectedIds: Set<string>;
  currentCategory: JDCategory | 'all';
  disabled?: boolean;
  onClose: () => void;
  onConfirm: (ids: Set<string>) => void;
}

export function TargetJDPickerDialog({
  jds,
  selectedIds,
  currentCategory,
  disabled = false,
  onClose,
  onConfirm,
}: TargetJDPickerDialogProps) {
  const [query, setQuery] = useState('');
  const [draftIds, setDraftIds] = useState<Set<string>>(() => new Set(selectedIds));

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const activeJds = useMemo(() => jds.filter((jd) => jd.status !== 'paused'), [jds]);
  const visibleJds = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return activeJds
      .filter((jd) => {
        if (!normalizedQuery) return true;
        return [jd.title, jd.organization, jd.serviceUnit, jd.department, jd.odc]
          .some((value) => String(value || '').toLowerCase().includes(normalizedQuery));
      })
      .sort((a, b) => {
        const selectedDelta = Number(draftIds.has(b.id)) - Number(draftIds.has(a.id));
        if (selectedDelta !== 0) return selectedDelta;
        const categoryDelta = Number(currentCategory !== 'all' && hasCategory(b, currentCategory))
          - Number(currentCategory !== 'all' && hasCategory(a, currentCategory));
        if (categoryDelta !== 0) return categoryDelta;
        return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
          || String(a.title || '').localeCompare(String(b.title || ''), 'zh-CN');
      });
  }, [activeJds, currentCategory, draftIds, query]);

  const toggleJD = (jdId: string) => {
    setDraftIds((previous) => {
      const next = new Set(previous);
      if (next.has(jdId)) next.delete(jdId);
      else next.add(jdId);
      return next;
    });
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/30 p-4 backdrop-blur-[2px]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="target-jd-picker-title"
        className="flex max-h-[82vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between border-b border-gray-100 px-6 py-5">
          <div className="flex gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
              <BriefcaseBusiness className="h-5 w-5" />
            </div>
            <div>
              <h3 id="target-jd-picker-title" className="text-lg font-semibold text-slate-900">指定匹配岗位</h3>
              <p className="mt-1 text-sm text-gray-500">确认后，本次只分析选中的岗位。</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600" aria-label="关闭">
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="border-b border-gray-100 px-6 py-4">
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索岗位名称、编制、服务单位或对接人"
              className="h-11 w-full rounded-xl border border-gray-200 bg-gray-50 pl-10 pr-4 text-sm text-slate-800 outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100"
            />
          </div>
          <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
            <span>
              {currentCategory === 'all'
                ? `共 ${activeJds.length} 个活跃岗位`
                : `已优先排列${JD_CATEGORY_LABELS[currentCategory]}岗位，可搜索全库`}
            </span>
            <button type="button" onClick={() => setDraftIds(new Set())} disabled={draftIds.size === 0} className="text-indigo-600 disabled:text-gray-300">
              清空已选
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-3">
          {visibleJds.length === 0 ? (
            <div className="py-16 text-center text-sm text-gray-400">没有找到符合条件的岗位</div>
          ) : (
            <div className="divide-y divide-gray-100">
              {visibleJds.map((jd) => {
                const selected = draftIds.has(jd.id);
                return (
                  <button
                    type="button"
                    key={jd.id}
                    onClick={() => toggleJD(jd.id)}
                    className={cn(
                      'flex w-full items-center gap-3 px-2 py-3 text-left transition-colors hover:bg-indigo-50/60',
                      selected && 'bg-indigo-50/70',
                    )}
                  >
                    <span className={cn(
                      'flex h-5 w-5 shrink-0 items-center justify-center rounded border',
                      selected ? 'border-indigo-500 bg-indigo-500 text-white' : 'border-gray-300 bg-white',
                    )}>
                      {selected && <Check className="h-3.5 w-3.5" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-slate-900">{jd.title}</span>
                      <span className="mt-1 block truncate text-xs text-gray-500">
                        {[jd.organization, jd.serviceUnit, jd.department].filter(Boolean).join(' / ') || '未填写部门信息'}
                      </span>
                    </span>
                    {jd.salaryText && <span className="shrink-0 text-xs font-medium text-emerald-600">{jd.salaryText}</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between border-t border-gray-100 bg-gray-50/70 px-6 py-4">
          <span className="text-sm text-gray-500">已选 <strong className="text-indigo-600">{draftIds.size}</strong> 个岗位</span>
          <div className="flex gap-3">
            <button type="button" onClick={onClose} className="h-10 rounded-xl border border-gray-200 bg-white px-4 text-sm font-medium text-gray-600 hover:bg-gray-50">
              取消
            </button>
            <button
              type="button"
              onClick={() => onConfirm(draftIds)}
              disabled={disabled || draftIds.size === 0}
              className="h-10 rounded-xl bg-indigo-600 px-5 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              使用已选 {draftIds.size} 个岗位
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
