'use client';
import { useState } from 'react';
import { Pencil, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TodoItem, TodoOwner, TodoPriority, TodoCategory } from '@/types/todo';
import { TODO_PRIORITY_LABEL, TODO_CATEGORY_LABEL } from '@/types/todo';

interface EditTodoModalProps {
  todo: TodoItem;
  ownerNames: Record<'a' | 'b', string>;
  onClose: () => void;
  onSave: (id: string, partial: Partial<TodoItem>) => void;
}

const PRIORITIES: TodoPriority[] = ['high', 'normal', 'low'];
const CATEGORIES: TodoCategory[] = ['follow', 'interview', 'offer', 'other'];

export function EditTodoModal({ todo, ownerNames, onClose, onSave }: EditTodoModalProps) {
  const [title, setTitle] = useState(todo.title);
  const [owner, setOwner] = useState<TodoOwner>(todo.owner);
  const [dueDate, setDueDate] = useState(todo.dueDate || '');
  const [priority, setPriority] = useState<TodoPriority>(todo.priority);
  const [category, setCategory] = useState<TodoCategory>(todo.category);
  const [note, setNote] = useState(todo.note || '');

  const ownerLabel = (o: TodoOwner) => (o === 'both' ? '共同' : ownerNames[o]);

  const handleSave = () => {
    if (!title.trim()) return;
    onSave(todo.id, {
      title: title.trim(),
      owner,
      dueDate: dueDate || undefined,
      priority,
      category,
      note: note.trim() || undefined,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white border border-gray-200 rounded-2xl shadow-2xl p-6 animate-fade-in">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-base font-semibold text-gray-800 flex items-center gap-2">
            <span className="w-7 h-7 rounded-lg bg-indigo-500 flex items-center justify-center"><Pencil className="w-4 h-4 text-white" /></span>
            编辑待办
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100" title="关闭"><X className="w-4 h-4" /></button>
        </div>

        <div className="space-y-4">
          <Field label="事项 *">
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="todo-input" placeholder="待办内容" />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="归属">
              <div className="flex rounded-xl border border-gray-200 overflow-hidden text-sm h-10">
                {(['a', 'b', 'both'] as TodoOwner[]).map((o) => (
                  <button key={o} onClick={() => setOwner(o)} className={cn('flex-1 font-medium transition-colors', owner === o ? 'bg-indigo-500 text-white' : 'bg-white text-gray-500 hover:bg-indigo-50')}>
                    {ownerLabel(o)}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="截止日">
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="todo-input cursor-pointer" />
            </Field>
            <Field label="重要程度">
              <div className="flex rounded-xl border border-gray-200 overflow-hidden text-sm h-10">
                {PRIORITIES.map((p) => (
                  <button key={p} onClick={() => setPriority(p)} className={cn('flex-1 font-medium transition-colors', priority === p ? 'bg-amber-500 text-white' : 'bg-white text-gray-500 hover:bg-amber-50')}>
                    {TODO_PRIORITY_LABEL[p]}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="分类">
              <select value={category} onChange={(e) => setCategory(e.target.value as TodoCategory)} className="todo-input cursor-pointer">
                {CATEGORIES.map((c) => <option key={c} value={c}>{TODO_CATEGORY_LABEL[c]}</option>)}
              </select>
            </Field>
          </div>

          <Field label="备注">
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="todo-input !h-auto py-2" placeholder="补充说明（可选）" />
          </Field>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="h-10 px-4 rounded-xl text-sm font-medium text-gray-500 hover:bg-gray-100">取消</button>
          <button
            onClick={handleSave}
            disabled={!title.trim()}
            className={cn('h-10 px-5 rounded-xl text-sm font-medium text-white transition-colors', title.trim() ? 'bg-indigo-500 hover:bg-indigo-600' : 'bg-gray-200 cursor-not-allowed')}
          >
            保存
          </button>
        </div>

        <style jsx>{`
          :global(.todo-input) {
            width: 100%;
            height: 2.5rem;
            padding: 0 0.75rem;
            border-radius: 0.75rem;
            background: #fff;
            border: 1px solid #e5e7eb;
            font-size: 0.875rem;
            outline: none;
          }
          :global(.todo-input:focus) { border-color: #a5b4fc; }
        `}</style>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      {children}
    </div>
  );
}
