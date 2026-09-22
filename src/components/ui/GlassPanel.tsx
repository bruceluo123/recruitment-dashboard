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
        'rounded-2xl border border-[#e5ebf3] bg-white shadow-[0_12px_36px_rgba(28,49,93,0.045),0_1px_2px_rgba(28,49,93,0.025)]',
        pad,
        hover && 'transition-[border-color,box-shadow] duration-200 hover:border-[#b8caf3] hover:shadow-[0_14px_32px_rgba(35,65,130,0.09)]',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
