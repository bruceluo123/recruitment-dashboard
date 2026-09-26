import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { generateId } from '@/lib/utils';
import { primaryTodoCategory } from '@/types/todo';
import type { TodoItem, TodoOwner, TodoPriority, TodoCategory, TodoPrimaryCategory } from '@/types/todo';

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
  moveTodo: (id: string, category: TodoPrimaryCategory, beforeId?: string) => void;
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
            position: (() => {
              const positions = s.todos
                .filter((item) => primaryTodoCategory(item.category) === primaryTodoCategory(todo.category || 'other'))
                .map((item) => item.position)
                .filter((position): position is number => position !== undefined);
              return positions.length ? Math.max(...positions) + 1 : undefined;
            })(),
            createdAt: new Date().toISOString(),
          },
        ],
      })),
      updateTodo: (id, partial) => set((s) => ({
        todos: s.todos.map((t) => {
          if (t.id !== id) return t;
          const changedCategory = partial.category
            && primaryTodoCategory(partial.category) !== primaryTodoCategory(t.category);
          return { ...t, ...partial, ...(changedCategory ? { position: undefined } : {}) };
        }),
      })),
      moveTodo: (id, category, beforeId) => set((s) => {
        const moved = s.todos.find((todo) => todo.id === id);
        if (!moved) return s;
        const targetItems = s.todos
          .filter((todo) => !todo.done && todo.id !== id && primaryTodoCategory(todo.category) === category)
          .sort((a, b) => {
            if (a.position !== undefined || b.position !== undefined) {
              const manual = (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER);
              if (manual !== 0) return manual;
            }
            return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          });
        const insertAt = beforeId ? targetItems.findIndex((todo) => todo.id === beforeId) : -1;
        targetItems.splice(insertAt >= 0 ? insertAt : targetItems.length, 0, { ...moved, category });
        const targetOrder = new Map(targetItems.map((todo, index) => [todo.id, index]));
        return {
          todos: s.todos.map((todo) => {
            const position = targetOrder.get(todo.id);
            if (position === undefined) return todo;
            return todo.id === id ? { ...todo, category, position } : { ...todo, position };
          }),
        };
      }),
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
