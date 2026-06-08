'use client';
import { useEffect, useState } from 'react';
import { ListTodo, CheckCircle2, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/ui/EmptyState';
import { useTodoStore } from '@/store/todo-store';
import { useRepushStore } from '@/store/repush-store';
import { usePrefStore } from '@/store/pref-store';
import type { TodoItem, TodoOwner } from '@/types/todo';
import { groupByTimeline } from '@/lib/todo-format';
import { AddTodoForm } from './AddTodoForm';
import { TodoRow } from './TodoRow';
import { EditTodoModal } from './EditTodoModal';

type OwnerFilter = 'all' | TodoOwner;

const BUCKET_DOT: Record<string, string> = {
  overdue: 'bg-red-500',
  today: 'bg-indigo-500',
  thisWeek: 'bg-amber-400',
  nextWeek: 'bg-cyan-400',
  later: 'bg-gray-300',
  noDate: 'bg-gray-200',
};

export function TodoBoardPage() {
  const [mounted, setMounted] = useState(false);
  const todos = useTodoStore((s) => s.todos);
  const addTodo = useTodoStore((s) => s.addTodo);
  const updateTodo = useTodoStore((s) => s.updateTodo);
  const toggleDone = useTodoStore((s) => s.toggleDone);
  const removeTodo = useTodoStore((s) => s.removeTodo);
  const columnNames = useRepushStore((s) => s.columnNames);
  const activeOwner = usePrefStore((s) => s.activeOwner);
  const setActiveOwner = usePrefStore((s) => s.setActiveOwner);

  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>('all');

  // 切到具体某人时记住为当前用户（共用表，'全部'/'共同' 不改身份）
  const handleOwnerFilter = (o: OwnerFilter) => {
    setOwnerFilter(o);
    if (o === 'a' || o === 'b') setActiveOwner(o);
  };
  const [showDone, setShowDone] = useState(false);
  const [editing, setEditing] = useState<TodoItem | null>(null);

  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  const ownerNames = { a: columnNames.a, b: columnNames.b };

  const filtered = todos.filter((t) => ownerFilter === 'all' || t.owner === ownerFilter);
  const active = filtered.filter((t) => !t.done);
  const completed = filtered.filter((t) => t.done);
  const groups = groupByTimeline(active);

  const ownerLabel = (o: OwnerFilter) =>
    o === 'all' ? '全部' : o === 'both' ? '共同' : ownerNames[o];

  return (
    <div className="animate-fade-in space-y-5 max-w-4xl mx-auto">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
            <ListTodo className="w-6 h-6 text-indigo-500" />待办事项
          </h2>
          <p className="text-sm text-gray-500 mt-1">{ownerNames.a} 和 {ownerNames.b} 共用一张表，按时间线一目了然未来要做什么。</p>
        </div>
        {/* 归属筛选 */}
        <div className="flex rounded-xl border border-gray-200 overflow-hidden text-sm shrink-0">
          {(['all', 'a', 'b', 'both'] as OwnerFilter[]).map((o) => (
            <button
              key={o}
              onClick={() => handleOwnerFilter(o)}
              className={cn('px-3 h-9 font-medium transition-colors', ownerFilter === o ? 'bg-indigo-500 text-white' : 'bg-white text-gray-500 hover:bg-indigo-50')}
            >
              {ownerLabel(o)}
            </button>
          ))}
        </div>
      </div>

      <AddTodoForm
        defaultOwner={ownerFilter === 'all' ? activeOwner : ownerFilter}
        ownerNames={ownerNames}
        onAdd={addTodo}
      />

      {/* 时间线分组 */}
      {groups.length > 0 ? (
        <div className="space-y-6">
          {groups.map((g) => (
            <div key={g.bucket}>
              <div className="flex items-center gap-2.5 mb-2.5">
                <span className={cn('w-2 h-2 rounded-full', BUCKET_DOT[g.bucket])} />
                <span className={cn('text-sm font-semibold', g.bucket === 'overdue' ? 'text-red-500' : 'text-gray-700')}>{g.label}</span>
                <span className="text-xs text-gray-300">{g.items.length}</span>
                <div className="flex-1 h-px bg-gray-100" />
              </div>
              <div className="space-y-2">
                {g.items.map((t) => (
                  <TodoRow key={t.id} todo={t} ownerNames={ownerNames} onToggle={toggleDone} onEdit={setEditing} onRemove={removeTodo} />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState icon={ListTodo} title="暂无待办" description="在上方添加一项未来要做的事，按截止日自动排进时间线" />
      )}

      {/* 已完成（折叠） */}
      {completed.length > 0 && (
        <div className="pt-2">
          <button
            onClick={() => setShowDone((v) => !v)}
            className="flex items-center gap-2 text-sm font-medium text-gray-400 hover:text-gray-600 transition-colors"
          >
            {showDone ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            <CheckCircle2 className="w-4 h-4" />已完成 {completed.length}
          </button>
          {showDone && (
            <div className="mt-3 space-y-2">
              {completed.map((t) => (
                <TodoRow key={t.id} todo={t} ownerNames={ownerNames} onToggle={toggleDone} onEdit={setEditing} onRemove={removeTodo} />
              ))}
            </div>
          )}
        </div>
      )}

      {editing && (
        <EditTodoModal todo={editing} ownerNames={ownerNames} onClose={() => setEditing(null)} onSave={updateTodo} />
      )}
    </div>
  );
}
