import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { generateId } from '@/lib/utils';
import type { TodoItem, TodoOwner, TodoPriority, TodoCategory } from '@/types/todo';

// 待办事项：麦满分/啵啵共用一张表，经 SyncProvider 同步到 Upstash KV 实现多端共享。

/** 新建一条待办所需字段 */
export interface NewTodo {
  owner: TodoOwner;
  title: string;
  dueDate?: string;
  priority?: TodoPriority;
  category?: TodoCategory;
  note?: string;
}

interface TodoStore {
  todos: TodoItem[];
  addTodo: (todo: NewTodo) => void;
  updateTodo: (id: string, partial: Partial<TodoItem>) => void;
  toggleDone: (id: string) => void;
  removeTodo: (id: string) => void;
}

export const useTodoStore = create<TodoStore>()(
  persist(
    (set) => ({
      todos: [],
      addTodo: (todo) => set((s) => ({
        todos: [
          ...s.todos,
          {
            id: generateId(),
            owner: todo.owner,
            title: todo.title.trim(),
            dueDate: todo.dueDate || undefined,
            priority: todo.priority || 'normal',
            category: todo.category || 'other',
            note: todo.note?.trim() || undefined,
            done: false,
            createdAt: new Date().toISOString(),
          },
        ],
      })),
      updateTodo: (id, partial) => set((s) => ({
        todos: s.todos.map((t) => (t.id === id ? { ...t, ...partial } : t)),
      })),
      toggleDone: (id) => set((s) => ({
        todos: s.todos.map((t) =>
          t.id === id
            ? { ...t, done: !t.done, completedAt: !t.done ? new Date().toISOString() : undefined }
            : t,
        ),
      })),
      removeTodo: (id) => set((s) => ({ todos: s.todos.filter((t) => t.id !== id) })),
    }),
    {
      name: 'recruitai-todo-store',
      version: 1,
    },
  ),
);
