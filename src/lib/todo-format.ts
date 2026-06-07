// 待办事项的时间线分组与日期格式化。

import { startOfDay, mondayOf } from '@/lib/repush-format';
import type { TodoItem } from '@/types/todo';

const DAY = 24 * 60 * 60 * 1000;
const DAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'];

/** 时间线分组键（按紧急度从上到下） */
export type TimelineBucket = 'overdue' | 'today' | 'thisWeek' | 'nextWeek' | 'later' | 'noDate';

export const BUCKET_ORDER: TimelineBucket[] = ['overdue', 'today', 'thisWeek', 'nextWeek', 'later', 'noDate'];

export const BUCKET_LABEL: Record<TimelineBucket, string> = {
  overdue: '已逾期',
  today: '今天',
  thisWeek: '本周',
  nextWeek: '下周',
  later: '更远',
  noDate: '无日期',
};

/** 判断一条待办（按截止日）归入哪个时间线分组 */
export function bucketOf(dueDate: string | undefined, now = new Date()): TimelineBucket {
  if (!dueDate) return 'noDate';
  const due = startOfDay(new Date(dueDate)).getTime();
  if (Number.isNaN(due)) return 'noDate';
  const today = startOfDay(now).getTime();
  if (due < today) return 'overdue';
  if (due === today) return 'today';
  const thisMonday = mondayOf(now).getTime();
  const nextMonday = thisMonday + 7 * DAY;
  const weekAfter = thisMonday + 14 * DAY;
  if (due < nextMonday) return 'thisWeek';
  if (due < weekAfter) return 'nextWeek';
  return 'later';
}

/** 截止日展示：如「6月10号(周二)」；逾期附「· 逾 N 天」 */
export function formatDueDate(dueDate: string, now = new Date()): string {
  const d = new Date(dueDate);
  if (Number.isNaN(d.getTime())) return dueDate;
  const base = `${d.getMonth() + 1}月${d.getDate()}号(周${DAY_NAMES[d.getDay()]})`;
  const due = startOfDay(d).getTime();
  const today = startOfDay(now).getTime();
  if (due < today) {
    const days = Math.round((today - due) / DAY);
    return `${base} · 逾${days}天`;
  }
  if (due === today) return `${base} · 今天`;
  return base;
}

/** 同一分组内排序：有日期的按日期升序，无日期保持创建顺序；重要置顶 */
const PRIORITY_WEIGHT: Record<TodoItem['priority'], number> = { high: 0, normal: 1, low: 2 };

export function sortInBucket(items: TodoItem[]): TodoItem[] {
  return [...items].sort((a, b) => {
    const pa = PRIORITY_WEIGHT[a.priority];
    const pb = PRIORITY_WEIGHT[b.priority];
    if (pa !== pb) return pa - pb;
    const da = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
    const db = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
    if (da !== db) return da - db;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
}

/** 把待办列表分组为时间线，返回非空分组（按 BUCKET_ORDER） */
export function groupByTimeline(items: TodoItem[], now = new Date()): { bucket: TimelineBucket; label: string; items: TodoItem[] }[] {
  const map = new Map<TimelineBucket, TodoItem[]>();
  for (const it of items) {
    const b = bucketOf(it.dueDate, now);
    const arr = map.get(b) || [];
    arr.push(it);
    map.set(b, arr);
  }
  return BUCKET_ORDER.filter((b) => map.has(b)).map((bucket) => ({
    bucket,
    label: BUCKET_LABEL[bucket],
    items: sortInBucket(map.get(bucket)!),
  }));
}

/** 今天的本地日期字符串 YYYY-MM-DD（供 date input 默认值用） */
export function todayDateInput(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
