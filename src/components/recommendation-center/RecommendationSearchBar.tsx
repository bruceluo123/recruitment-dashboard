'use client';
import { useMemo, useState } from 'react';
import { ChevronDown, Search, SlidersHorizontal, X } from 'lucide-react';
import type { RepushItem } from '@/store/repush-store';

/** 七项查找条件：均为「输入 + 下拉」（datalist），留空表示不限。 */
export interface RecommendationFilters {
  query: string;
  code: string;
  name: string;
  job: string;
  org: string;
  dept: string;
  contact: string;
  handler: string;
}

export const EMPTY_FILTERS: RecommendationFilters = {
  query: '', code: '', name: '', job: '', org: '', dept: '', contact: '', handler: '',
};

interface RecommendationSearchBarProps {
  items: RepushItem[];   // 当前推荐人列的全部记录，用于取下拉候选值
  filters: RecommendationFilters;
  onChange: (next: RecommendationFilters) => void;
}

/** 推荐记录中某字段的去重非空值，作为下拉候选。 */
function distinctValues(items: RepushItem[], pick: (it: RepushItem) => string | undefined): string[] {
  const set = new Set<string>();
  for (const it of items) { const v = pick(it)?.trim(); if (v) set.add(v); }
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

/** 候选人姓名优先取 candidateName，回退到显示名 fileName。 */
function nameOf(it: RepushItem): string {
  return (it.candidateName || it.fileName || '').trim();
}

export function RecommendationSearchBar({ items, filters, onChange }: RecommendationSearchBarProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const codeOpts = useMemo(() => distinctValues(items, (it) => it.candidateCode), [items]);
  const nameOpts = useMemo(() => distinctValues(items, nameOf), [items]);
  const jobOpts = useMemo(() => distinctValues(items, (it) => it.jdTitle), [items]);
  const orgOpts = useMemo(() => distinctValues(items, (it) => it.organization), [items]);
  const deptOpts = useMemo(() => distinctValues(items, (it) => it.department), [items]);
  const contactOpts = useMemo(() => distinctValues(items, (it) => it.contact), [items]);
  const handlerOpts = useMemo(() => distinctValues(items, (it) => it.contactPerson), [items]);

  const set = (key: keyof RecommendationFilters, value: string) => onChange({ ...filters, [key]: value });
  const hasAny = Object.values(filters).some((v) => v.trim());
  const advancedCount = Object.entries(filters).filter(([key, value]) => key !== 'query' && value.trim()).length;

  const fields: Array<{ key: keyof RecommendationFilters; label: string; opts: string[] }> = [
    { key: 'code', label: '编码', opts: codeOpts },
    { key: 'name', label: '姓名', opts: nameOpts },
    { key: 'job', label: '岗位', opts: jobOpts },
    { key: 'org', label: '编制', opts: orgOpts },
    { key: 'dept', label: '部门', opts: deptOpts },
    { key: 'contact', label: '联系方式', opts: contactOpts },
    { key: 'handler', label: '简历对接人', opts: handlerOpts },
  ];

  return (
    <div className="mb-4 rounded-xl border border-slate-200/80 bg-slate-50/70 p-2.5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={filters.query}
            onChange={(event) => set('query', event.target.value)}
            placeholder="搜索姓名、编码、岗位、部门或联系人"
            className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-700 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
          />
        </label>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            aria-expanded={showAdvanced}
            onClick={() => setShowAdvanced((current) => !current)}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-600 transition hover:border-indigo-200 hover:text-indigo-600"
          >
            <SlidersHorizontal className="h-4 w-4" />
            高级筛选
            {advancedCount > 0 && <span className="rounded-full bg-indigo-50 px-1.5 text-xs text-indigo-600">{advancedCount}</span>}
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
          </button>
          {hasAny && (
            <button
              type="button"
              onClick={() => onChange(EMPTY_FILTERS)}
              className="inline-flex h-10 items-center gap-1 rounded-lg px-2 text-xs text-slate-400 transition hover:bg-white hover:text-slate-600"
            >
              <X className="h-3.5 w-3.5" />清空
            </button>
          )}
        </div>
      </div>
      {showAdvanced && (
        <div className="mt-2.5 grid grid-cols-2 gap-2 border-t border-slate-200/70 pt-2.5 md:grid-cols-4 xl:grid-cols-7">
          {fields.map((field) => (
            <div key={field.key}>
              <input
                list={`rec-filter-${field.key}`}
                value={filters[field.key]}
                onChange={(event) => set(field.key, event.target.value)}
                placeholder={field.label}
                className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
              />
              <datalist id={`rec-filter-${field.key}`}>
                {field.opts.map((option) => <option key={option} value={option} />)}
              </datalist>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** 按七项条件（子串、忽略大小写）过滤推荐记录；空条件不限。 */
export function filterRecommendations(items: RepushItem[], filters: RecommendationFilters): RepushItem[] {
  const norm = (s: string) => s.trim().toLowerCase();
  const match = (value: string | undefined, query: string) => {
    const q = norm(query);
    if (!q) return true;
    return (value || '').toLowerCase().includes(q);
  };
  return items.filter((it) =>
    (!norm(filters.query) || [
      it.candidateCode,
      nameOf(it),
      it.jdTitle,
      it.organization,
      it.department,
      it.contact,
      it.contactPerson,
    ].some((value) => match(value, filters.query))) &&
    match(it.candidateCode, filters.code) &&
    match(nameOf(it), filters.name) &&
    match(it.jdTitle, filters.job) &&
    match(it.organization, filters.org) &&
    match(it.department, filters.dept) &&
    match(it.contact, filters.contact) &&
    match(it.contactPerson, filters.handler),
  );
}
