'use client';

import Link from 'next/link';
import { FormEvent, PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  GripVertical,
  ListTodo,
  Plus,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { bucketOf, sortInBucket, todayDateInput } from '@/lib/todo-format';
import { useEscapeClose } from '@/hooks/useEscapeClose';
import { usePrefStore } from '@/store/pref-store';
import { useRepushStore } from '@/store/repush-store';
import { useTodoStore } from '@/store/todo-store';
import { primaryTodoCategory, TODO_PRIMARY_CATEGORIES, TODO_CATEGORY_LABEL } from '@/types/todo';
import type { TodoItem, TodoPrimaryCategory } from '@/types/todo';

const TRIGGER_POSITION_KEY = 'recruitai-quick-todo-trigger-top';
const TRIGGER_HEIGHT = 48;
const TRIGGER_MARGIN = 16;
const QUICK_TODO_GROUP_STYLE: Record<TodoPrimaryCategory, { header: string; dot: string }> = {
  recruitment: { header: 'bg-blue-50 text-blue-700', dot: 'bg-blue-500' },
  supervision: { header: 'bg-amber-50 text-amber-700', dot: 'bg-amber-500' },
  other: { header: 'bg-slate-100 text-slate-700', dot: 'bg-slate-400' },
};

function clampTriggerTop(top: number, viewportHeight: number) {
  return Math.min(Math.max(top, TRIGGER_MARGIN), Math.max(TRIGGER_MARGIN, viewportHeight - TRIGGER_HEIGHT - TRIGGER_MARGIN));
}

function completedToday(todo: TodoItem, today: string) {
  if (!todo.done || !todo.completedAt) return false;
  return todayDateInput(new Date(todo.completedAt)) === today;
}

export function QuickTodoDrawer() {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<TodoPrimaryCategory>('recruitment');
  const [triggerTop, setTriggerTop] = useState<number>();
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerDragRef = useRef<{ pointerId: number; startY: number; startTop: number; moved: boolean } | null>(null);
  const ignoreTriggerClickRef = useRef(false);

  const todos = useTodoStore((state) => state.todos);
  const addTodo = useTodoStore((state) => state.addTodo);
  const toggleDone = useTodoStore((state) => state.toggleDone);
  const activeOwner = usePrefStore((state) => state.activeOwner);
  const columnNames = useRepushStore((state) => state.columnNames);

  const today = todayDateInput();
  const visibleTodos = useMemo(
    () => todos.filter((todo) => todo.owner === activeOwner || todo.owner === 'both'),
    [activeOwner, todos],
  );
  const actionable = useMemo(
    () => sortInBucket(visibleTodos.filter((todo) => {
      if (todo.done) return false;
      const bucket = bucketOf(todo.dueDate);
      return bucket === 'overdue' || bucket === 'today' || bucket === 'noDate';
    })),
    [visibleTodos],
  );
  const doneToday = useMemo(
    () => visibleTodos.filter((todo) => completedToday(todo, today)).slice().reverse(),
    [today, visibleTodos],
  );
  const upcomingCount = useMemo(
    () => visibleTodos.filter((todo) => {
      if (todo.done) return false;
      const bucket = bucketOf(todo.dueDate);
      return bucket !== 'overdue' && bucket !== 'today' && bucket !== 'noDate';
    }).length,
    [visibleTodos],
  );
  const actionableGroups = useMemo(
    () => TODO_PRIMARY_CATEGORIES.map((groupCategory) => ({
      category: groupCategory,
      items: actionable.filter((todo) => primaryTodoCategory(todo.category) === groupCategory),
    })),
    [actionable],
  );

  useEffect(() => {
    const savedTop = Number(window.localStorage.getItem(TRIGGER_POSITION_KEY));
    const initialTop = Number.isFinite(savedTop) && savedTop > 0 ? savedTop : window.innerHeight * 0.42;
    setTriggerTop(clampTriggerTop(initialTop, window.innerHeight));
    setMounted(true);

    const handleResize = () => {
      setTriggerTop((current) => clampTriggerTop(current ?? window.innerHeight * 0.42, window.innerHeight));
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 180);
    return () => window.clearTimeout(timer);
  }, [open]);
  useEscapeClose(() => setOpen(false), open);

  if (!mounted) return null;

  const ownerName = columnNames[activeOwner];
  const totalToday = actionable.length + doneToday.length;
  const progress = totalToday > 0 ? Math.round((doneToday.length / totalToday) * 100) : 0;

  const handleAdd = (event: FormEvent) => {
    event.preventDefault();
    const nextTitle = title.trim();
    if (!nextTitle) return;
    addTodo({
      owner: activeOwner,
      title: nextTitle,
      dueDate: today,
      priority: 'normal',
      category,
    });
    setTitle('');
    inputRef.current?.focus();
  };

  const handleTriggerPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || triggerTop === undefined) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    triggerDragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startTop: triggerTop,
      moved: false,
    };
  };

  const handleTriggerPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = triggerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const delta = event.clientY - drag.startY;
    if (Math.abs(delta) >= 4) drag.moved = true;
    setTriggerTop(clampTriggerTop(drag.startTop + delta, window.innerHeight));
  };

  const finishTriggerDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = triggerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const finalTop = clampTriggerTop(drag.startTop + event.clientY - drag.startY, window.innerHeight);
    setTriggerTop(finalTop);
    if (drag.moved) {
      window.localStorage.setItem(TRIGGER_POSITION_KEY, String(Math.round(finalTop)));
      ignoreTriggerClickRef.current = true;
      window.setTimeout(() => { ignoreTriggerClickRef.current = false; }, 0);
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    triggerDragRef.current = null;
  };

  const handleTriggerClick = () => {
    if (ignoreTriggerClickRef.current) return;
    setOpen(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={handleTriggerClick}
        onPointerDown={handleTriggerPointerDown}
        onPointerMove={handleTriggerPointerMove}
        onPointerUp={finishTriggerDrag}
        onPointerCancel={finishTriggerDrag}
        style={{ top: triggerTop }}
        className={cn(
          'fixed right-0 z-40 flex h-12 touch-none cursor-ns-resize select-none items-center gap-2 rounded-l-lg border border-r-0 border-blue-500 bg-blue-600 px-3 text-sm font-semibold text-white shadow-lg shadow-blue-200/70 transition-[background-color,box-shadow,transform,opacity] hover:bg-blue-700 active:cursor-grabbing focus:outline-none focus:ring-2 focus:ring-blue-300 focus:ring-offset-2',
          open && 'pointer-events-none translate-x-full opacity-0',
        )}
        aria-label={`打开今日待办，${actionable.length} 项未完成`}
        title="点击展开，上下拖动调整位置"
      >
        <GripVertical className="-ml-1 h-4 w-4 text-blue-200" />
        <ListTodo className="h-4 w-4" />
        <span>今日待办</span>
        <span className="flex h-6 min-w-6 items-center justify-center rounded-md bg-white px-1.5 text-xs font-bold text-blue-700">
          {actionable.length}
        </span>
      </button>

      <aside
        className={cn(
          'fixed inset-y-0 right-0 z-[70] flex w-full max-w-[420px] flex-col border-l border-slate-200 bg-white shadow-2xl shadow-slate-900/15 transition-transform duration-200 ease-out',
          open ? 'translate-x-0' : 'pointer-events-none translate-x-full',
        )}
        aria-hidden={!open}
        aria-label="今日待办快捷面板"
      >
        <header className="border-b border-slate-200 px-5 pb-4 pt-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                  <ListTodo className="h-5 w-5" />
                </span>
                <div>
                  <h2 className="text-lg font-bold text-slate-900">今日待办</h2>
                  <p className="text-xs text-slate-500">{ownerName} · {new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' })}</p>
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
              aria-label="收起今日待办"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="mt-5 flex items-center gap-3">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${progress}%` }} />
            </div>
            <span className="shrink-0 text-xs font-medium text-slate-500">
              已完成 {doneToday.length}/{totalToday}
            </span>
          </div>
        </header>

        <form onSubmit={handleAdd} className="border-b border-slate-100 px-5 py-4">
          <label htmlFor="quick-todo-title" className="mb-2 block text-xs font-semibold text-slate-600">
            快速记一件事
          </label>
          <div className="flex h-11 items-center rounded-lg border border-blue-200 bg-blue-50/40 pl-3 transition-colors focus-within:border-blue-500 focus-within:bg-white focus-within:ring-2 focus-within:ring-blue-100">
            <Plus className="h-4 w-4 shrink-0 text-blue-600" />
            <input
              ref={inputRef}
              id="quick-todo-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="输入任务，按 Enter 添加"
              className="h-full min-w-0 flex-1 bg-transparent px-2 text-sm text-slate-900 outline-none placeholder:text-slate-400"
            />
            <button
              type="submit"
              disabled={!title.trim()}
              className="mr-1 flex h-9 items-center justify-center rounded-lg bg-blue-600 px-3 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-200"
            >
              添加
            </button>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="text-xs font-medium text-slate-500">待办类型</span>
            <div className="flex h-8 overflow-hidden rounded-lg border border-slate-200 bg-white p-0.5">
              {TODO_PRIMARY_CATEGORIES.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setCategory(option)}
                  className={cn(
                    'min-w-16 rounded-md px-3 text-xs font-semibold transition-colors',
                    category === option ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700',
                  )}
                >
                  {TODO_CATEGORY_LABEL[option]}
                </button>
              ))}
            </div>
          </div>
          <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-400">
            <CalendarDays className="h-3.5 w-3.5" />自动归到今天，需要改日期时进入完整待办
          </p>
        </form>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-800">现在要做</h3>
            <span className="text-xs text-slate-400">{actionable.length} 项</span>
          </div>

          {actionable.length > 0 ? (
            <div className="space-y-5">
              {actionableGroups.map((group) => {
                const style = QUICK_TODO_GROUP_STYLE[group.category];
                return (
                  <section key={group.category}>
                    <div className={cn('mb-2 flex h-9 items-center gap-2 rounded-lg px-3', style.header)}>
                      <span className={cn('h-2 w-2 rounded-full', style.dot)} />
                      <h4 className="text-sm font-bold">{TODO_CATEGORY_LABEL[group.category]}</h4>
                      <span className="ml-auto text-xs font-semibold opacity-70">{group.items.length}</span>
                    </div>
                    {group.items.length > 0 ? (
                      <div className="space-y-2">
                        {group.items.map((todo) => (
                          <QuickTodoRow key={todo.id} todo={todo} ownerName={todo.owner === 'both' ? '共同' : ownerName} onToggle={toggleDone} />
                        ))}
                      </div>
                    ) : (
                      <p className="px-3 py-1 text-xs text-slate-400">暂无{TODO_CATEGORY_LABEL[group.category]}待办</p>
                    )}
                  </section>
                );
              })}
            </div>
          ) : (
            <div className="flex min-h-40 flex-col items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/70 px-5 text-center">
              <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                <CheckCircle2 className="h-5 w-5" />
              </span>
              <p className="text-sm font-semibold text-slate-700">今天已经清空</p>
              <p className="mt-1 text-xs text-slate-400">有新任务时直接在上方记下来</p>
            </div>
          )}

          {doneToday.length > 0 && (
            <section className="mt-6">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-400">
                <CheckCircle2 className="h-4 w-4" />今天已完成
              </div>
              <div className="space-y-1">
                {doneToday.slice(0, 5).map((todo) => (
                  <button
                    key={todo.id}
                    type="button"
                    onClick={() => toggleDone(todo.id)}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-600"
                    title="恢复为未完成"
                  >
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
                      <Check className="h-3 w-3" />
                    </span>
                    <span className="truncate line-through">{todo.title}</span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>

        <footer className="border-t border-slate-200 bg-slate-50/70 px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-slate-400">{upcomingCount > 0 ? `另有 ${upcomingCount} 项已安排在之后` : '没有未来待办'}</span>
            <Link
              href="/todos"
              onClick={() => setOpen(false)}
              className="flex h-9 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-blue-600 transition-colors hover:bg-blue-50"
            >
              完整待办<ChevronRight className="h-4 w-4" />
            </Link>
          </div>
        </footer>
      </aside>
    </>
  );
}

function QuickTodoRow({ todo, ownerName, onToggle }: { todo: TodoItem; ownerName: string; onToggle: (id: string) => void }) {
  const bucket = bucketOf(todo.dueDate);
  const overdue = bucket === 'overdue';

  return (
    <div className={cn(
      'group flex min-h-14 items-center gap-3 rounded-lg border bg-white px-3 py-2.5 transition-colors',
      overdue ? 'border-rose-200 bg-rose-50/50' : todo.priority === 'high' ? 'border-amber-200 bg-amber-50/40' : 'border-slate-200 hover:border-blue-200',
    )}>
      <button
        type="button"
        onClick={() => onToggle(todo.id)}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-slate-300 text-white transition-colors hover:border-emerald-500 hover:bg-emerald-50"
        aria-label={`完成：${todo.title}`}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-800">{todo.title}</p>
        <div className="mt-1 flex items-center gap-2 text-[11px]">
          <span className={cn('font-medium', overdue ? 'text-rose-500' : 'text-slate-400')}>
            {overdue ? '已逾期' : bucket === 'noDate' ? '待处理' : '今天'}
          </span>
          {todo.priority === 'high' && <span className="text-amber-600">重要</span>}
          {todo.owner === 'both' && <span className="text-indigo-500">{ownerName}</span>}
        </div>
      </div>
    </div>
  );
}
