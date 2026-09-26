'use client';

import Link from 'next/link';
import { DragEvent as ReactDragEvent, FormEvent, PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  GripVertical,
  ListTodo,
  Pencil,
  Plus,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDueDate, sortInBucket, todayDateInput } from '@/lib/todo-format';
import { parseDueDateFromText } from '@/lib/todo-date';
import { useEscapeClose } from '@/hooks/useEscapeClose';
import { usePrefStore } from '@/store/pref-store';
import { useRepushStore } from '@/store/repush-store';
import { useTodoStore } from '@/store/todo-store';
import { primaryTodoCategory, TODO_PRIMARY_CATEGORIES, TODO_CATEGORY_LABEL } from '@/types/todo';
import type { TodoItem, TodoPrimaryCategory } from '@/types/todo';
import { EditTodoModal } from './EditTodoModal';

const TRIGGER_POSITION_KEY = 'recruitai-quick-todo-trigger-top';
const TRIGGER_HEIGHT = 48;
const TRIGGER_MARGIN = 16;
const QUICK_TODO_SECTION_STYLE: Record<TodoPrimaryCategory, {
  shell: string;
  header: string;
  dot: string;
  button: string;
}> = {
  other: {
    shell: 'border-slate-200',
    header: 'bg-slate-50/90',
    dot: 'bg-slate-400',
    button: 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-100',
  },
  recruitment: {
    shell: 'border-blue-200',
    header: 'bg-blue-50/80',
    dot: 'bg-blue-500',
    button: 'border-blue-200 bg-white text-blue-700 hover:border-blue-300 hover:bg-blue-50',
  },
  supervision: {
    shell: 'border-violet-200',
    header: 'bg-violet-50/80',
    dot: 'bg-violet-500',
    button: 'border-violet-200 bg-white text-violet-700 hover:border-violet-300 hover:bg-violet-50',
  },
  reminder: {
    shell: 'border-amber-200',
    header: 'bg-amber-50/80',
    dot: 'bg-amber-500',
    button: 'border-amber-200 bg-white text-amber-700 hover:border-amber-300 hover:bg-amber-50',
  },
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
  const [activeCategory, setActiveCategory] = useState<TodoPrimaryCategory | null>(null);
  const [editing, setEditing] = useState<TodoItem | null>(null);
  const [draggedTodoId, setDraggedTodoId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ category: TodoPrimaryCategory; beforeId?: string } | null>(null);
  const [triggerTop, setTriggerTop] = useState<number>();
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerDragRef = useRef<{ pointerId: number; startY: number; startTop: number; moved: boolean } | null>(null);
  const touchDragRef = useRef<{ pointerId: number; todoId: string; startX: number; startY: number; moved: boolean } | null>(null);
  const ignoreTriggerClickRef = useRef(false);

  const todos = useTodoStore((state) => state.todos);
  const addTodo = useTodoStore((state) => state.addTodo);
  const updateTodo = useTodoStore((state) => state.updateTodo);
  const moveTodo = useTodoStore((state) => state.moveTodo);
  const toggleDone = useTodoStore((state) => state.toggleDone);
  const activeOwner = usePrefStore((state) => state.activeOwner);
  const columnNames = useRepushStore((state) => state.columnNames);

  const today = todayDateInput();
  const parsedTitleDate = title.trim() ? parseDueDateFromText(title) : null;
  const visibleTodos = useMemo(
    () => todos.filter((todo) => todo.owner === activeOwner || todo.owner === 'both'),
    [activeOwner, todos],
  );
  const actionable = useMemo(
    () => sortInBucket(visibleTodos.filter((todo) => !todo.done), true),
    [visibleTodos],
  );
  const doneToday = useMemo(
    () => visibleTodos.filter((todo) => completedToday(todo, today)).slice().reverse(),
    [today, visibleTodos],
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
    if (!open || !activeCategory) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 180);
    return () => window.clearTimeout(timer);
  }, [activeCategory, open]);
  useEscapeClose(() => setOpen(false), open && !editing);

  if (!mounted) return null;

  const ownerName = columnNames[activeOwner];
  const handleAdd = (event: FormEvent) => {
    event.preventDefault();
    const nextTitle = title.trim();
    if (!nextTitle || !activeCategory) return;
    addTodo({
      owner: activeOwner,
      title: parsedTitleDate?.rest.trim() || nextTitle,
      dueDate: parsedTitleDate?.date,
      priority: 'normal',
      category: activeCategory,
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

  const finishTodoDrop = (todoId: string, target: { category: TodoPrimaryCategory; beforeId?: string } | null) => {
    if (target && target.beforeId !== todoId) moveTodo(todoId, target.category, target.beforeId);
    setDraggedTodoId(null);
    setDropTarget(null);
  };

  const handleTodoDragStart = (event: ReactDragEvent<HTMLDivElement>, todoId: string) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', todoId);
    setDraggedTodoId(todoId);
  };

  const handleTouchDragStart = (event: ReactPointerEvent<HTMLButtonElement>, todoId: string) => {
    if (event.pointerType === 'mouse') return;
    event.currentTarget.setPointerCapture(event.pointerId);
    touchDragRef.current = {
      pointerId: event.pointerId,
      todoId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
  };

  const handleTouchDragMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = touchDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6) return;
    drag.moved = true;
    setDraggedTodoId(drag.todoId);
    const element = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
    const card = element?.closest<HTMLElement>('[data-todo-drop-id]');
    const section = element?.closest<HTMLElement>('[data-todo-drop-category]');
    const category = section?.dataset.todoDropCategory as TodoPrimaryCategory | undefined;
    if (category) setDropTarget({ category, beforeId: card?.dataset.todoDropId || undefined });
  };

  const handleTouchDragEnd = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = touchDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    finishTodoDrop(drag.todoId, drag.moved ? dropTarget : null);
    touchDragRef.current = null;
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
        aria-label={`打开待办，${actionable.length} 项未完成`}
        title="点击展开，上下拖动调整位置"
      >
        <GripVertical className="-ml-1 h-4 w-4 text-blue-200" />
        <ListTodo className="h-4 w-4" />
        <span>待办</span>
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
        aria-label="待办快捷面板"
      >
        <header className="border-b border-slate-200 px-5 pb-4 pt-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                  <ListTodo className="h-5 w-5" />
                </span>
                <div>
                  <h2 className="text-lg font-bold text-slate-900">待办</h2>
                  <p className="text-xs text-slate-500">{ownerName} · 未完成事项持续保留</p>
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
              aria-label="收起待办"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="mt-5 flex items-center gap-2 text-xs font-medium">
            <span className="rounded-md bg-blue-50 px-2 py-1 text-blue-700">待完成 {actionable.length}</span>
            <span className="rounded-md bg-emerald-50 px-2 py-1 text-emerald-700">今日完成 {doneToday.length}</span>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          <p className="mb-3 flex items-center gap-1.5 px-1 text-xs text-slate-400">
            <GripVertical className="h-3.5 w-3.5" />
            拖动卡片可调整分层和顺序；输入时间会自动识别提醒
          </p>

          <div className="space-y-3">
            {TODO_PRIMARY_CATEGORIES.map((sectionCategory) => {
              const sectionTodos = actionable.filter((todo) => primaryTodoCategory(todo.category) === sectionCategory);
              const sectionStyle = QUICK_TODO_SECTION_STYLE[sectionCategory];
              const isAdding = activeCategory === sectionCategory;
              return (
                <section
                  key={sectionCategory}
                  data-todo-drop-category={sectionCategory}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                    setDropTarget({ category: sectionCategory });
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const target = dropTarget?.category === sectionCategory ? dropTarget : { category: sectionCategory };
                    finishTodoDrop(event.dataTransfer.getData('text/plain') || draggedTodoId || '', target);
                  }}
                  className={cn(
                    'overflow-hidden rounded-xl border bg-white transition-[border-color,box-shadow,transform]',
                    sectionStyle.shell,
                    draggedTodoId && dropTarget?.category === sectionCategory && 'ring-2 ring-blue-300 ring-offset-2',
                  )}
                >
                  <div className={cn('flex min-h-12 items-center justify-between gap-3 border-b border-inherit px-3 py-2', sectionStyle.header)}>
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', sectionStyle.dot)} />
                      <h3 className="text-sm font-bold text-slate-800">{TODO_CATEGORY_LABEL[sectionCategory]}</h3>
                      <span className="rounded-md bg-white/90 px-1.5 py-0.5 text-[11px] font-semibold text-slate-500 shadow-sm ring-1 ring-black/5">
                        {sectionTodos.length}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setTitle('');
                        setActiveCategory(isAdding ? null : sectionCategory);
                      }}
                      className={cn('inline-flex h-8 items-center gap-1 rounded-lg border px-2.5 text-xs font-semibold transition-colors', sectionStyle.button)}
                      aria-expanded={isAdding}
                      aria-label={`添加${TODO_CATEGORY_LABEL[sectionCategory]}待办`}
                    >
                      {isAdding ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                      {isAdding ? '收起' : '添加'}
                    </button>
                  </div>

                  {isAdding && (
                    <form autoComplete="off" onSubmit={handleAdd} className="border-b border-slate-100 bg-white p-3">
                      <div className="flex h-10 items-center rounded-lg border border-blue-200 bg-blue-50/30 pl-2.5 transition-colors focus-within:border-blue-500 focus-within:bg-white focus-within:ring-2 focus-within:ring-blue-100">
                        <Plus className="h-4 w-4 shrink-0 text-blue-600" />
                        <input
                          ref={inputRef}
                          id={`quick-todo-entry-${sectionCategory}`}
                          name={`quick-todo-entry-${sectionCategory}`}
                          autoComplete="off"
                          autoCorrect="off"
                          spellCheck={false}
                          data-1p-ignore
                          data-lpignore="true"
                          value={title}
                          onChange={(event) => setTitle(event.target.value)}
                          placeholder={`记录一条${TODO_CATEGORY_LABEL[sectionCategory]}`}
                          className="h-full min-w-0 flex-1 bg-transparent px-2 text-sm text-slate-900 outline-none placeholder:text-slate-400"
                        />
                        <button
                          type="submit"
                          disabled={!title.trim()}
                          className="mr-1 flex h-8 items-center justify-center rounded-md bg-blue-600 px-3 text-xs font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-200"
                        >
                          添加
                        </button>
                      </div>
                      {parsedTitleDate && (
                        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-400">
                          <CalendarDays className="h-3 w-3" />已识别提醒时间：
                          <span className="font-medium text-indigo-500">{formatDueDate(parsedTitleDate.date)}</span>
                        </p>
                      )}
                    </form>
                  )}

                  <div className="space-y-2 p-2.5">
                    {sectionTodos.length > 0 ? sectionTodos.map((todo) => (
                      <QuickTodoRow
                        key={todo.id}
                        todo={todo}
                        dragging={draggedTodoId === todo.id}
                        dropBefore={dropTarget?.category === sectionCategory && dropTarget.beforeId === todo.id && draggedTodoId !== todo.id}
                        ownerName={todo.owner === 'both' ? '共同' : ownerName}
                        onToggle={toggleDone}
                        onEdit={setEditing}
                        onDragStart={handleTodoDragStart}
                        onDragOver={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          event.dataTransfer.dropEffect = 'move';
                          setDropTarget({ category: sectionCategory, beforeId: todo.id });
                        }}
                        onDragEnd={() => {
                          setDraggedTodoId(null);
                          setDropTarget(null);
                        }}
                        onTouchDragStart={handleTouchDragStart}
                        onTouchDragMove={handleTouchDragMove}
                        onTouchDragEnd={handleTouchDragEnd}
                      />
                    )) : (
                      <div className="flex h-12 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/50 text-xs text-slate-400">
                        暂无{TODO_CATEGORY_LABEL[sectionCategory]}待办
                      </div>
                    )}
                  </div>
                </section>
              );
            })}
          </div>

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
            <span className="text-xs text-slate-400">共 {actionable.length} 项待完成</span>
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

      {editing && (
        <EditTodoModal
          todo={editing}
          ownerNames={{ a: columnNames.a, b: columnNames.b }}
          onClose={() => setEditing(null)}
          onSave={updateTodo}
        />
      )}
    </>
  );
}

function QuickTodoRow({
  todo,
  ownerName,
  dragging,
  dropBefore,
  onToggle,
  onEdit,
  onDragStart,
  onDragOver,
  onDragEnd,
  onTouchDragStart,
  onTouchDragMove,
  onTouchDragEnd,
}: {
  todo: TodoItem;
  ownerName: string;
  dragging: boolean;
  dropBefore: boolean;
  onToggle: (id: string) => void;
  onEdit: (todo: TodoItem) => void;
  onDragStart: (event: ReactDragEvent<HTMLDivElement>, todoId: string) => void;
  onDragOver: (event: ReactDragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  onTouchDragStart: (event: ReactPointerEvent<HTMLButtonElement>, todoId: string) => void;
  onTouchDragMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onTouchDragEnd: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  return (
    <div
      draggable
      data-todo-drop-id={todo.id}
      onDragStart={(event) => onDragStart(event, todo.id)}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      className={cn(
      'group relative flex min-h-14 items-center gap-2 rounded-lg border bg-white px-2 py-2.5 transition-[border-color,box-shadow,opacity,transform]',
      todo.priority === 'high' ? 'border-amber-200 bg-amber-50/40' : 'border-slate-200 hover:border-blue-200',
      dragging && 'scale-[0.98] opacity-45 shadow-none',
      dropBefore && 'before:absolute before:-top-[6px] before:left-2 before:right-2 before:h-0.5 before:rounded-full before:bg-blue-500',
    )}>
      <button
        type="button"
        onPointerDown={(event) => onTouchDragStart(event, todo.id)}
        onPointerMove={onTouchDragMove}
        onPointerUp={onTouchDragEnd}
        onPointerCancel={onTouchDragEnd}
        className="flex h-8 w-5 touch-none cursor-grab shrink-0 items-center justify-center rounded text-slate-300 transition-colors hover:bg-slate-100 hover:text-slate-500 active:cursor-grabbing"
        aria-label={`拖动：${todo.title}`}
        title="拖动调整分层或顺序"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => onToggle(todo.id)}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-slate-300 text-white transition-colors hover:border-emerald-500 hover:bg-emerald-50"
        aria-label={`完成：${todo.title}`}
      />
      <div className="min-w-0 flex-1">
        <p className="whitespace-normal break-words text-sm font-medium leading-5 text-slate-800">{todo.title}</p>
        <div className="mt-1 flex items-center gap-2 text-[11px]">
          <span className="font-medium text-slate-400">待处理</span>
          {todo.dueDate && (
            <span className="inline-flex items-center gap-1 text-indigo-500">
              <CalendarDays className="h-3 w-3" />{formatDueDate(todo.dueDate)}
            </span>
          )}
          {todo.priority === 'high' && <span className="text-amber-600">重要</span>}
          {todo.owner === 'both' && <span className="text-indigo-500">{ownerName}</span>}
        </div>
      </div>
      <button
        type="button"
        onClick={() => onEdit(todo)}
        className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium text-slate-500 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
        aria-label={`编辑：${todo.title}`}
        title="编辑"
      >
        <Pencil className="h-3.5 w-3.5" />编辑
      </button>
    </div>
  );
}
