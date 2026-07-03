import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/** 返回给定日期(默认今天)所在周的周一日期字符串，如 "2026-06-22"，用作本周新增 weekKey。 */
export function mondayKey(date: Date = new Date()): string {
  const day = date.getDay(); // 0=Sun
  const mon = new Date(date);
  mon.setDate(date.getDate() + (day === 0 ? -6 : 1 - day));
  return `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, '0')}-${String(mon.getDate()).padStart(2, '0')}`;
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

export function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

export function formatInterviewDate(dateStr: string): string {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;

  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  // Monday of current week
  const dow = now.getDay(); // 0=Sun
  const diffToMon = dow === 0 ? -6 : 1 - dow;
  const thisMonday = new Date(todayStart);
  thisMonday.setDate(todayStart.getDate() + diffToMon);

  const nextMonday = new Date(thisMonday);
  nextMonday.setDate(thisMonday.getDate() + 7);
  const weekAfterNext = new Date(thisMonday);
  weekAfterNext.setDate(thisMonday.getDate() + 14);

  const dateStart = new Date(date);
  dateStart.setHours(0, 0, 0, 0);

  const dayNames = ['日', '一', '二', '三', '四', '五', '六'];
  const dayName = dayNames[date.getDay()];
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const timeStr = `${hh}:${mm}`;

  // 今天/明天标记：仅当面试日期为今天或明天时附加
  const diffDays = Math.round((dateStart.getTime() - todayStart.getTime()) / 86400000);
  const relTag = diffDays === 0 ? ' 今天' : diffDays === 1 ? ' 明天' : '';

  if (dateStart >= thisMonday && dateStart < nextMonday) {
    return `本周${dayName}${relTag} ${month}月${day}号 ${timeStr}`;
  } else if (dateStart >= nextMonday && dateStart < weekAfterNext) {
    return `下周${dayName}${relTag} ${month}月${day}号 ${timeStr}`;
  } else {
    return `${month}月${day}号(周${dayName})${relTag} ${timeStr}`;
  }
}

export function formatSalary(range: { min: number; max: number; currency: string }, text?: string): string {
  if (text && !range.min && !range.max) return text;
  if (!range.min && !range.max) return '-';
  if (text) return text;
  return `${range.min}K-${range.max}K`;
}
