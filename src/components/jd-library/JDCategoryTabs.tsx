'use client';
import { cn } from '@/lib/utils';
import type { JDCategory } from '@/types/jd';

const CAT_TAB_COLORS: Record<string, { active: string; idle: string }> = {
  all:        { active: 'bg-gray-800 text-white border-gray-800', idle: 'text-gray-500 border-gray-200' },
  frontend:   { active: 'bg-blue-500 text-white border-blue-500', idle: 'text-blue-600 border-blue-200' },
  backend:    { active: 'bg-emerald-500 text-white border-emerald-500', idle: 'text-emerald-600 border-emerald-200' },
  testing:    { active: 'bg-yellow-500 text-white border-yellow-500', idle: 'text-yellow-600 border-yellow-200' },
  product: { active: 'bg-indigo-500 text-white border-indigo-500', idle: 'text-indigo-600 border-indigo-200' },
  design: { active: 'bg-violet-500 text-white border-violet-500', idle: 'text-violet-600 border-violet-200' },
  data: { active: 'bg-zinc-700 text-white border-zinc-700', idle: 'text-zinc-600 border-zinc-200' },
  hardware: { active: 'bg-neutral-700 text-white border-neutral-700', idle: 'text-neutral-600 border-neutral-200' },
  devops:     { active: 'bg-orange-500 text-white border-orange-500', idle: 'text-orange-600 border-orange-200' },
  ai:         { active: 'bg-green-500 text-white border-green-500', idle: 'text-green-600 border-green-200' },
  algorithm:  { active: 'bg-slate-700 text-white border-slate-700', idle: 'text-slate-600 border-slate-200' },
  operations: { active: 'bg-cyan-500 text-white border-cyan-500', idle: 'text-cyan-600 border-cyan-200' },
  advertising:{ active: 'bg-fuchsia-500 text-white border-fuchsia-500', idle: 'text-fuchsia-600 border-fuchsia-200' },
  gaming:     { active: 'bg-purple-500 text-white border-purple-500', idle: 'text-purple-600 border-purple-200' },
  finance:    { active: 'bg-amber-500 text-white border-amber-500', idle: 'text-amber-600 border-amber-200' },
  hr:         { active: 'bg-lime-500 text-white border-lime-500', idle: 'text-lime-600 border-lime-200' },
  bd:         { active: 'bg-pink-500 text-white border-pink-500', idle: 'text-pink-600 border-pink-200' },
  'customer-service': { active: 'bg-teal-500 text-white border-teal-500', idle: 'text-teal-600 border-teal-200' },
  project:    { active: 'bg-rose-500 text-white border-rose-500', idle: 'text-rose-600 border-rose-200' },
  seo:        { active: 'bg-sky-500 text-white border-sky-500', idle: 'text-sky-600 border-sky-200' },
  administration: { active: 'bg-stone-500 text-white border-stone-500', idle: 'text-stone-600 border-stone-200' },
  director:   { active: 'bg-red-500 text-white border-red-500', idle: 'text-red-600 border-red-200' },
};

interface JDCategoryTabsProps {
  categories: { id: JDCategory | 'all'; label: string; count: number }[];
  activeCategory: JDCategory | 'all';
  onCategoryChange: (category: JDCategory | 'all') => void;
}

export function JDCategoryTabs({ categories, activeCategory, onCategoryChange }: JDCategoryTabsProps) {
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1">
      {categories.map((cat) => {
        const isActive = activeCategory === cat.id;
        const c = CAT_TAB_COLORS[cat.id] || CAT_TAB_COLORS.all;
        return (
          <button
            key={cat.id}
            onClick={() => onCategoryChange(cat.id)}
            className={cn(
              'px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-all flex items-center gap-1.5 border shadow-sm',
              isActive ? c.active : `bg-white hover:bg-gray-50 ${c.idle}`,
            )}
          >
            {cat.label}
            <span className={cn('text-xs px-1.5 py-0.5 rounded-md', isActive ? 'bg-white/20' : 'bg-gray-100')}>
              {cat.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
