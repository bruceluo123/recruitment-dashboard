'use client';
import { cn } from '@/lib/utils';
import type { HTMLAttributes } from 'react';

interface GlassPanelProps extends HTMLAttributes<HTMLDivElement> {
  hover?: boolean;
  padding?: 'sm' | 'md' | 'lg' | 'none';
}

export function GlassPanel({ children, className, hover = false, padding = 'md', ...props }: GlassPanelProps) {
  const pad = { none: '', sm: 'p-4', md: 'p-6', lg: 'p-8' }[padding];
  return (
    <div
      className={cn(
        'bg-white rounded-2xl border border-gray-200 shadow-sm',
        pad,
        hover && 'hover:shadow-md hover:border-indigo-200 transition-all duration-300',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
