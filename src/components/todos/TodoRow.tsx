'use client';
import { useState } from 'react';
import { Check, Trash2, Pencil } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TodoItem, TodoOwner } from '@/types/todo';
import { TODO_CATEGORY_LABEL, TODO_PRIORITY_LABEL } from '@/types/todo';
import { formatDueDate } from '@/lib/todo-format';

interface TodoRowProps {
  todo: TodoItem;
  ownerNames: Record<'a' | 'b', string>;
  onToggle: (id: string) => void;
  onEdit: (todo: TodoItem) => void;
  onRemove: (id: string) => void;
}

const OWNER_STYLE: Record<TodoOwner, string> = {
  a: 'bg-indigo-50 text-indigo-600',
  b: 'bg-emerald-50 text-emerald-600',
  both: 'bg-purple-50 text-purple-600',
};

/** 重要项：左侧色条 + 背景微染 + 边框，整条更显眼 */
const PRIORITY_CARD: Record<TodoItem['priority'], string> = {
  high: 'border-red-200 bg-red-50/60 hover:border-red-300 hover:shadow-sm',
  normal: 'border-gray-100 hover:border-indigo-200 hover:shadow-sm',
  low: 'border-gray-100 bg-gray-50/40',
};

/** 左侧竖条颜色（重要=红、普通=琥珀、次要=灰） */
const PRIORITY_BAR: Record<TodoItem['priority'], string> = {
  high: 'bg-red-500',
  normal: 'bg-amber-400',
  low: 'bg-gray-200',
};

/** 重要徽标 */
const PRIORITY_BADGE: Record<TodoItem['priority'], string | null> = {
  high: 'bg-red-500 text-white',
  normal: null,
  low: 'bg-gray-100 text-gray-400',
};

export function TodoRow({ todo, ownerNames, onToggle, onEdit, onRemove }: TodoRowProps) {
  const [confirming, setConfirming] = useState(false);
  const ownerLabel = todo.owner === 'both' ? '共同' : ownerNames[todo.owner];
  const overdue = !todo.done && todo.dueDate && new Date(todo.dueDate).setHours(0, 0, 0, 0) < new Date().setHours(0, 0, 0, 0);
  const badge = PRIORITY_BADGE[todo.priority];

  return (
    <div className={cn(
      'group relative flex items-center gap-3 pl-5 pr-4 py-3 rounded-2xl border bg-white transition-all overflow-hidden',
      todo.done ? 'border-gray-100 opacity-60' : overdue ? 'border-red-200 bg-red-50/60 hover:border-red-300' : PRIORITY_CARD[todo.priority],
    )}>
      {/* 左侧优先级竖条 */}
      {!todo.done && <span className={cn('absolute left-0 top-0 bottom-0 w-1.5', PRIORITY_BAR[todo.priority])} />}

      {/* 完成勾选 */}
      <button
        onClick={() => onToggle(todo.id)}
        className={cn(
          'w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors',
          todo.done ? 'bg-green-500 border-green-500 text-white' : 'border-gray-300 hover:border-green-400',
        )}
        title={todo.done ? '标记未完成' : '标记完成'}
      >
        {todo.done && <Check className="w-3 h-3" />}
      </button>

      {/* 主信息 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          {/* 重要/次要徽标（普通不显示，保持干净） */}
          {!todo.done && badge && (
            <span className={cn('px-1.5 py-0.5 rounded-md text-[11px] font-semibold shrink-0 self-center', badge)}>
              {TODO_PRIORITY_LABEL[todo.priority]}
            </span>
          )}
          {/* 日期前置、加粗、显眼 */}
          {todo.dueDate && (
            <span className={cn(
              todo.priority === 'high' && !todo.done ? 'text-lg font-extrabold' : 'text-base font-bold',
              'shrink-0',
              todo.done ? 'text-gray-400' : overdue ? 'text-red-500' : todo.priority === 'high' ? 'text-red-600' : 'text-indigo-600',
            )}>
              {formatDueDate(todo.dueDate)}
            </span>
          )}
          <span className={cn(
            'truncate',
            todo.priority === 'high' && !todo.done ? 'text-base font-bold' : 'text-sm font-medium',
            todo.done ? 'text-gray-400 line-through' : todo.priority === 'low' ? 'text-gray-500' : 'text-gray-800',
          )}>{todo.title}</span>
          <span className={cn('px-1.5 py-0.5 rounded-md text-[11px] font-medium shrink-0 self-center', OWNER_STYLE[todo.owner])}>{ownerLabel}</span>
          {todo.category !== 'other' && (
            <span className="px-1.5 py-0.5 rounded-md bg-gray-100 text-gray-500 text-[11px] shrink-0 self-center">{TODO_CATEGORY_LABEL[todo.category]}</span>
          )}
        </div>
        {todo.note && <p className="mt-1 text-xs text-gray-400 truncate">{todo.note}</p>}
      </div>

      {/* 操作 */}
      <div className="flex items-center gap-1.5 shrink-0">
        <button onClick={() => onEdit(todo)} className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-500 hover:bg-indigo-50 transition-all" title="编辑">
          <Pencil className="w-4 h-4" />
        </button>
        {confirming ? (
          <div className="flex items-center gap-1">
            <button onClick={() => { onRemove(todo.id); setConfirming(false); }} className="px-2 h-8 rounded-lg text-xs font-medium bg-red-500 text-white hover:bg-red-600">确认删除</button>
            <button onClick={() => setConfirming(false)} className="px-2 h-8 rounded-lg text-xs text-gray-500 hover:bg-gray-100">取消</button>
          </div>
        ) : (
          <button onClick={() => setConfirming(true)} className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-all opacity-0 group-hover:opacity-100" title="删除">
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}
