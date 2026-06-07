'use client';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { NewTodo } from '@/store/todo-store';
import type { TodoOwner, TodoPriority, TodoCategory } from '@/types/todo';
import { TODO_PRIORITY_LABEL, TODO_CATEGORY_LABEL } from '@/types/todo';
import { parseDueDateFromText } from '@/lib/todo-date';
import { formatDueDate } from '@/lib/todo-format';

interface AddTodoFormProps {
  defaultOwner: TodoOwner;
  ownerNames: Record<'a' | 'b', string>;
  onAdd: (todo: NewTodo) => void;
}

const PRIORITIES: TodoPriority[] = ['high', 'normal', 'low'];
const CATEGORIES: TodoCategory[] = ['follow', 'interview', 'offer', 'other'];

export function AddTodoForm({ defaultOwner, ownerNames, onAdd }: AddTodoFormProps) {
  const [title, setTitle] = useState('');
  const [owner, setOwner] = useState<TodoOwner>(defaultOwner === 'both' ? 'both' : defaultOwner);
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState<TodoPriority>('normal');
  const [category, setCategory] = useState<TodoCategory>('other');

  const ownerLabel = (o: TodoOwner) => (o === 'both' ? '共同' : ownerNames[o]);

  // 未手动选日期时，尝试从标题里识别相对日期（今天/下周三/6.10…）
  const parsed = !dueDate ? parseDueDateFromText(title) : null;

  const submit = () => {
    const t = title.trim();
    if (!t) return;
    // 手动选了日期优先；否则用从标题识别到的日期，并把日期短语从标题剥离
    const finalDue = dueDate || parsed?.date;
    const finalTitle = dueDate ? t : (parsed?.rest.trim() || t);
    onAdd({ owner, title: finalTitle, dueDate: finalDue || undefined, priority, category });
    setTitle('');
    setDueDate('');
    setPriority('normal');
    setCategory('other');
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-4 space-y-3">
      <div className="flex items-center gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          placeholder="添加一项待办，如「6.10 跟进 AI 产品候选人」"
          className="flex-1 h-10 px-3 rounded-xl border border-gray-200 text-sm focus:border-indigo-300 focus:outline-none"
        />
        <button
          onClick={submit}
          disabled={!title.trim()}
          className="flex items-center gap-1 px-4 h-10 rounded-xl bg-indigo-500 text-white text-sm font-medium hover:bg-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
        >
          <Plus className="w-4 h-4" />添加
        </button>
      </div>

      {/* 识别到日期时的提示 */}
      {parsed && (
        <p className="text-xs text-indigo-500">
          已识别日期 → <span className="font-medium">{formatDueDate(parsed.date)}</span>
          {parsed.rest && parsed.rest !== title && <span className="text-gray-400">，标题：{parsed.rest}</span>}
        </p>
      )}

      <div className="flex items-center gap-x-4 gap-y-2 flex-wrap text-xs">
        {/* 归属 */}
        <div className="flex items-center gap-1.5">
          <span className="text-gray-400">归属</span>
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            {(['a', 'b', 'both'] as TodoOwner[]).map((o) => (
              <button
                key={o}
                onClick={() => setOwner(o)}
                className={cn('px-2.5 h-7 font-medium transition-colors', owner === o ? 'bg-indigo-500 text-white' : 'bg-white text-gray-500 hover:bg-indigo-50')}
              >
                {ownerLabel(o)}
              </button>
            ))}
          </div>
        </div>

        {/* 截止日 */}
        <div className="flex items-center gap-1.5">
          <span className="text-gray-400">截止日</span>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="h-7 px-2 rounded-lg border border-gray-200 text-xs text-gray-600 focus:border-indigo-300 focus:outline-none"
          />
        </div>

        {/* 重要程度 */}
        <div className="flex items-center gap-1.5">
          <span className="text-gray-400">程度</span>
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            {PRIORITIES.map((p) => (
              <button
                key={p}
                onClick={() => setPriority(p)}
                className={cn('px-2.5 h-7 font-medium transition-colors', priority === p ? 'bg-amber-500 text-white' : 'bg-white text-gray-500 hover:bg-amber-50')}
              >
                {TODO_PRIORITY_LABEL[p]}
              </button>
            ))}
          </div>
        </div>

        {/* 分类 */}
        <div className="flex items-center gap-1.5">
          <span className="text-gray-400">分类</span>
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                className={cn('px-2.5 h-7 font-medium transition-colors', category === c ? 'bg-gray-700 text-white' : 'bg-white text-gray-500 hover:bg-gray-100')}
              >
                {TODO_CATEGORY_LABEL[c]}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
