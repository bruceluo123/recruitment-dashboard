// 待办事项类型：麦满分/啵啵两人共用一张表，按时间线展示未来重要事项。

import type { RepushColumnId } from '@/store/repush-store';

/** 事项归属：a=麦满分 / b=啵啵 / both=共同事项 */
export type TodoOwner = RepushColumnId | 'both';

/** 重要程度（影响排序与高亮） */
export type TodoPriority = 'high' | 'normal' | 'low';

/** 待办的三个主类型；旧分类继续兼容，展示时统一归入「招聘」。 */
export const TODO_PRIMARY_CATEGORIES = ['recruitment', 'supervision', 'other'] as const;
export type TodoPrimaryCategory = typeof TODO_PRIMARY_CATEGORIES[number];
export type TodoCategory = TodoPrimaryCategory | 'follow' | 'interview' | 'offer';

export function primaryTodoCategory(category: TodoCategory): TodoPrimaryCategory {
  if (category === 'supervision') return 'supervision';
  if (category === 'other') return 'other';
  return 'recruitment';
}

export interface TodoItem {
  id: string;
  owner: TodoOwner;
  title: string;
  dueDate?: string;            // 截止日（YYYY-MM-DD，只到日期；无日期则归入「无日期」组）
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
  recruitment: '招聘',
  supervision: '督导',
  other: '其他',
  follow: '招聘',
  interview: '招聘',
  offer: '招聘',
};
