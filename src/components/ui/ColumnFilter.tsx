'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ListFilter, Search, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ColumnFilterProps {
  label: string;
  options: string[];          // 所有可选值（去重）
  selected: Set<string>;      // 已勾选的值；空集合 = 不筛选（全部显示）
  onChange: (next: Set<string>) => void;
  emptyLabel?: string;        // 表示"空值"的展示文案，默认 (空)
}

const EMPTY_TOKEN = '__EMPTY__';

export function ColumnFilter({ label, options, selected, onChange, emptyLabel = '(空)' }: ColumnFilterProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  const active = selected.size > 0;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.toLowerCase().includes(q));
  }, [options, query]);

  const toggle = (value: string) => {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange(next);
  };

  const selectAll = () => onChange(new Set()); // 清空筛选 = 显示全部

  return (
    <div ref={ref} className="relative inline-flex items-center gap-1">
      <span className="uppercase tracking-wider">{label}</span>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className={cn(
          'p-1 rounded transition-colors',
          active ? 'text-indigo-600 bg-indigo-50' : 'text-gray-300 hover:text-gray-500 hover:bg-gray-100',
        )}
        title={active ? `已筛选 ${selected.size} 项` : '筛选'}
      >
        <ListFilter className="w-3.5 h-3.5" />
      </button>

      {open && (
        <div className="absolute left-0 top-7 z-30 w-56 bg-white border border-gray-200 rounded-xl shadow-lg p-2 normal-case">
          <div className="relative mb-2">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-300" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索…"
              className="w-full h-8 pl-8 pr-2 rounded-lg border border-gray-200 text-xs text-gray-700 outline-none focus:border-indigo-300"
            />
          </div>

          <div className="flex items-center justify-between px-1 pb-1.5 mb-1 border-b border-gray-100">
            <button onClick={selectAll} className="text-xs text-indigo-500 hover:text-indigo-600">全部显示</button>
            {active && <span className="text-xs text-gray-400">已选 {selected.size}</span>}
          </div>

          <div className="max-h-56 overflow-y-auto space-y-0.5">
            {filtered.length === 0 ? (
              <p className="text-xs text-gray-300 text-center py-4">无匹配项</p>
            ) : (
              filtered.map((opt) => {
                const checked = selected.has(opt);
                return (
                  <button
                    key={opt || EMPTY_TOKEN}
                    onClick={() => toggle(opt)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left hover:bg-gray-50 transition-colors"
                  >
                    <span className={cn(
                      'w-4 h-4 rounded border flex items-center justify-center shrink-0',
                      checked ? 'bg-indigo-500 border-indigo-500' : 'border-gray-300',
                    )}>
                      {checked && <Check className="w-3 h-3 text-white" />}
                    </span>
                    <span className="text-xs text-gray-700 truncate">{opt || emptyLabel}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
