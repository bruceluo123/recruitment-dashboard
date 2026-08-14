'use client';
import { cn } from '@/lib/utils';
import type { HTMLAttributes } from 'react';

interface GlassPanelProps extends HTMLAttributes<HTMLDivElement> {
  hover?: boolean;
  padding?: 'sm' | 'md' | 'lg' | 'none';
}

export function GlassPanel({ children, className, hover = false, padding = 'md', ...props }: GlassPanelProps) {
  const pad = { none: '', sm: 'p-4', md: 'p-5', lg: 'p-6' }[padding];
  return (
    <div
      className={cn(
        'bg-white rounded-lg border border-slate-200/90 shadow-[0_1px_2px_rgba(15,23,42,0.035)]',
        pad,
        hover && 'hover:shadow-[0_8px_24px_rgba(15,23,42,0.07)] hover:border-blue-200 transition-all duration-200',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
