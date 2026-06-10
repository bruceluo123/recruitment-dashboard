'use client';
import { useMemo } from 'react';
import { Search, X } from 'lucide-react';
import type { RepushItem } from '@/store/repush-store';

/** 六项查找条件：均为「输入 + 下拉」（datalist），留空表示不限。 */
export interface RecommendationFilters {
  name: string;
  job: string;
  org: string;
  dept: string;
  contact: string;
  handler: string;
}

export const EMPTY_FILTERS: RecommendationFilters = {
  name: '', job: '', org: '', dept: '', contact: '', handler: '',
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
  const nameOpts = useMemo(() => distinctValues(items, nameOf), [items]);
  const jobOpts = useMemo(() => distinctValues(items, (it) => it.jdTitle), [items]);
  const orgOpts = useMemo(() => distinctValues(items, (it) => it.organization), [items]);
  const deptOpts = useMemo(() => distinctValues(items, (it) => it.department), [items]);
  const contactOpts = useMemo(() => distinctValues(items, (it) => it.contact), [items]);
  const handlerOpts = useMemo(() => distinctValues(items, (it) => it.contactPerson), [items]);

  const set = (key: keyof RecommendationFilters, value: string) => onChange({ ...filters, [key]: value });
  const hasAny = Object.values(filters).some((v) => v.trim());

  const fields: Array<{ key: keyof RecommendationFilters; label: string; opts: string[] }> = [
    { key: 'name', label: '姓名', opts: nameOpts },
    { key: 'job', label: '岗位', opts: jobOpts },
    { key: 'org', label: '编制', opts: orgOpts },
    { key: 'dept', label: '部门', opts: deptOpts },
    { key: 'contact', label: '联系方式', opts: contactOpts },
    { key: 'handler', label: '简历对接人', opts: handlerOpts },
  ];

  return (
    <div className="mb-4 p-3 rounded-xl bg-gray-50 border border-gray-100">
      <div className="flex items-center justify-between mb-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-gray-500">
          <Search className="w-3.5 h-3.5 text-gray-400" />查找推荐
        </span>
        {hasAny && (
          <button onClick={() => onChange(EMPTY_FILTERS)} className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600">
            <X className="w-3 h-3" />清空
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        {fields.map((f) => (
          <div key={f.key}>
            <input
              list={`rec-filter-${f.key}`}
              value={filters[f.key]}
              onChange={(e) => set(f.key, e.target.value)}
              placeholder={f.label}
              className="w-full h-9 px-3 rounded-lg bg-white border border-gray-200 text-sm focus:outline-none focus:border-indigo-300"
            />
            <datalist id={`rec-filter-${f.key}`}>
              {f.opts.map((o) => <option key={o} value={o} />)}
            </datalist>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 按六项条件（子串、忽略大小写）过滤推荐记录；空条件不限。 */
export function filterRecommendations(items: RepushItem[], filters: RecommendationFilters): RepushItem[] {
  const norm = (s: string) => s.trim().toLowerCase();
  const match = (value: string | undefined, query: string) => {
    const q = norm(query);
    if (!q) return true;
    return (value || '').toLowerCase().includes(q);
  };
  return items.filter((it) =>
    match(nameOf(it), filters.name) &&
    match(it.jdTitle, filters.job) &&
    match(it.organization, filters.org) &&
    match(it.department, filters.dept) &&
    match(it.contact, filters.contact) &&
    match(it.contactPerson, filters.handler),
  );
}
