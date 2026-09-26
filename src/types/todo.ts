// 待办事项类型：麦满分/啵啵两人共用一张表，未完成事项持续保留。

import type { RepushColumnId } from '@/store/repush-store';

/** 事项归属：a=麦满分 / b=啵啵 / both=共同事项 */
export type TodoOwner = RepushColumnId | 'both';

/** 重要程度（影响排序与高亮） */
export type TodoPriority = 'high' | 'normal' | 'low';

/** 待办四个主分层；沿用旧值保证历史数据无需迁移。 */
export const TODO_PRIMARY_CATEGORIES = ['other', 'recruitment', 'supervision', 'reminder'] as const;
export type TodoPrimaryCategory = typeof TODO_PRIMARY_CATEGORIES[number];
export type TodoCategory = TodoPrimaryCategory | 'follow' | 'interview' | 'offer';

export function primaryTodoCategory(category: TodoCategory): TodoPrimaryCategory {
  if (category === 'reminder') return 'reminder';
  if (category === 'supervision') return 'supervision';
  if (category === 'other') return 'other';
  return 'recruitment';
}

export interface TodoItem {
  id: string;
  owner: TodoOwner;
  title: string;
  dueDate?: string;            // 提醒日期（YYYY-MM-DD，仅作备注，不产生逾期状态）
  priority: TodoPriority;
  category: TodoCategory;
  note?: string;
  done: boolean;
  createdAt: string;           // ISO
  completedAt?: string;        // ISO，标记完成时写入
}

export const TODO_PRIORITY_LABEL: Record<TodoPriority, string> = {
  high: '重要',
  normal: '普通',
  low: '次要',
};

export const TODO_CATEGORY_LABEL: Record<TodoCategory, string> = {
  recruitment: '工作',
  supervision: '系统',
  other: '杂事',
  reminder: '提醒',
  follow: '工作',
  interview: '工作',
  offer: '工作',
};
