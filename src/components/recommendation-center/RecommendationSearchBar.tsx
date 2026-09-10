'use client';
import { Search, X } from 'lucide-react';
import type { RepushItem } from '@/store/repush-store';

/** 七项查找条件：均为纯文本输入，留空表示不限。 */
export interface RecommendationFilters {
  code: string;
  name: string;
  job: string;
  org: string;
  dept: string;
  contact: string;
  handler: string;
}

export const EMPTY_FILTERS: RecommendationFilters = {
  code: '', name: '', job: '', org: '', dept: '', contact: '', handler: '',
};

interface RecommendationSearchBarProps {
  filters: RecommendationFilters;
  onChange: (next: RecommendationFilters) => void;
}

/** 候选人姓名优先取 candidateName，回退到显示名 fileName。 */
function nameOf(it: RepushItem): string {
  return (it.candidateName || it.fileName || '').trim();
}

export function RecommendationSearchBar({ filters, onChange }: RecommendationSearchBarProps) {
  const set = (key: keyof RecommendationFilters, value: string) => onChange({ ...filters, [key]: value });
  const hasAny = Object.values(filters).some((v) => v.trim());

  const fields: Array<{ key: keyof RecommendationFilters; label: string }> = [
    { key: 'code', label: '编码' },
    { key: 'name', label: '姓名' },
    { key: 'job', label: '岗位' },
    { key: 'org', label: '编制' },
    { key: 'dept', label: '部门' },
    { key: 'contact', label: '联系方式' },
    { key: 'handler', label: '简历对接人' },
  ];

  return (
    <div className="mb-4 rounded-xl border border-gray-100 bg-gray-50 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-medium text-gray-500">
          <Search className="h-3.5 w-3.5 text-gray-400" />查找推荐
        </span>
        {hasAny && (
          <button type="button" onClick={() => onChange(EMPTY_FILTERS)} className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600">
            <X className="h-3 w-3" />清空
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
        {fields.map((field) => (
          <div key={field.key}>
            <input
              value={filters[field.key]}
              onChange={(event) => set(field.key, event.target.value)}
              placeholder={field.label}
              autoComplete="off"
              className="h-9 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none focus:border-indigo-300"
            />
          </div>
        ))}
      </div>
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
    match(it.candidateCode, filters.code) &&
    match(nameOf(it), filters.name) &&
    match(it.jdTitle, filters.job) &&
    match(it.organization, filters.org) &&
    match(it.department, filters.dept) &&
    match(it.contact, filters.contact) &&
    match(it.contactPerson, filters.handler),
  );
}
