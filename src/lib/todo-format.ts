// 待办事项排序与提醒日期格式化。

import { startOfDay, mondayOf } from '@/lib/repush-format';
import type { TodoItem } from '@/types/todo';

const DAY = 24 * 60 * 60 * 1000;
const DAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'];

/** 未完成事项统一属于待办；日期只用于备注提醒。 */
export type TimelineBucket = 'pending';

export const BUCKET_ORDER: TimelineBucket[] = ['pending'];

export const BUCKET_LABEL: Record<TimelineBucket, string> = {
  pending: '待办',
};

/**
 * 提醒日期展示：未来日期显示相对时间，过去日期保留原日期，不产生“逾期”状态。
 */
export function formatDueDate(dueDate: string, now = new Date()): string {
  const d = new Date(dueDate);
  if (Number.isNaN(d.getTime())) return dueDate;
  const compact = `${d.getMonth() + 1}月${d.getDate()}号`;
  const absolute = `${compact}(周${DAY_NAMES[d.getDay()]})`;
  const due = startOfDay(d).getTime();
  const today = startOfDay(now).getTime();
  const diff = Math.round((due - today) / DAY);

  if (diff < 0) return absolute;
  if (diff === 0) return `今天 ${compact}`;
  if (diff === 1) return `明天 ${compact}`;
  if (diff === 2) return `后天 ${compact}`;

  const thisMonday = mondayOf(now).getTime();
  const weekday = DAY_NAMES[d.getDay()];
  if (due < thisMonday + 7 * DAY) return `本周${weekday} ${compact}`;
  if (due < thisMonday + 14 * DAY) return `下周${weekday} ${compact}`;
  return absolute;
}

/** 所有待办按重要程度排序，同级保持创建顺序；提醒日期不改变待办性质。 */
const PRIORITY_WEIGHT: Record<TodoItem['priority'], number> = { high: 0, normal: 1, low: 2 };

export function sortInBucket(items: TodoItem[]): TodoItem[] {
  return [...items].sort((a, b) => {
    const pa = PRIORITY_WEIGHT[a.priority];
    const pb = PRIORITY_WEIGHT[b.priority];
    if (pa !== pb) return pa - pb;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
}

/** 所有未完成事项统一进入待办组。 */
export function groupByTimeline(items: TodoItem[]): { bucket: TimelineBucket; label: string; items: TodoItem[] }[] {
  if (!items.length) return [];
  return [{ bucket: 'pending', label: BUCKET_LABEL.pending, items: sortInBucket(items) }];
}

/** 今天的本地日期字符串 YYYY-MM-DD（供 date input 默认值用） */
export function todayDateInput(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
