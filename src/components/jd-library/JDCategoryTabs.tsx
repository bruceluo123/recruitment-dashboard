'use client';
import { cn } from '@/lib/utils';
import type { JDCategory } from '@/types/jd';

interface JDCategoryTabsProps {
  categories: { id: JDCategory | 'all'; label: string; count: number }[];
  activeCategory: JDCategory | 'all';
  onCategoryChange: (category: JDCategory | 'all') => void;
}

export function JDCategoryTabs({ categories, activeCategory, onCategoryChange }: JDCategoryTabsProps) {
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1">
      {categories.map((cat) => (
        <button key={cat.id} onClick={() => onCategoryChange(cat.id)} className={cn(
          'px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-all flex items-center gap-1.5',
          activeCategory === cat.id
            ? 'bg-indigo-500 text-white shadow-sm'
            : 'text-gray-500 hover:text-gray-700 bg-white border border-gray-200 hover:border-gray-300',
        )}>
          {cat.label}
          <span className={cn('text-xs px-1.5 py-0.5 rounded-md', activeCategory === cat.id ? 'bg-white/20' : 'bg-gray-100')}>{cat.count}</span>
        </button>
      ))}
    </div>
  );
}
