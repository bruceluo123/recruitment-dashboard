'use client';
import { cn } from '@/lib/utils';

interface StatusBadgeProps {
  variant: 'active' | 'inactive' | 'pending' | 'success' | 'error' | 'warning' | 'info';
  label: string;
  pulse?: boolean;
  className?: string;
}

const variants = {
  active: 'bg-green-100 text-green-700',
  inactive: 'bg-gray-100 text-gray-500',
  pending: 'bg-amber-100 text-amber-700',
  success: 'bg-emerald-100 text-emerald-700',
  error: 'bg-red-100 text-red-700',
  warning: 'bg-orange-100 text-orange-700',
  info: 'bg-blue-100 text-blue-700',
};

const dotColors = {
  active: 'bg-green-500', inactive: 'bg-gray-400', pending: 'bg-amber-500',
  success: 'bg-emerald-500', error: 'bg-red-500', warning: 'bg-orange-500', info: 'bg-blue-500',
};

export function StatusBadge({ variant, label, pulse = false, className }: StatusBadgeProps) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium', variants[variant], className)}>
      <span className={cn('w-1.5 h-1.5 rounded-full', dotColors[variant], pulse && 'animate-pulse')} />
      {label}
    </span>
  );
}
