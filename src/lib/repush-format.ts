// 推荐数据相关的时间格式化与未反馈清单生成工具。

import type { RepushItem } from '@/store/repush-store';

const DAY = 24 * 60 * 60 * 1000;
const DAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'];

/** 把日期归零到当天 00:00 */
export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** 取某日期所在周的周一（周一为一周起点），归零到 00:00 */
export function mondayOf(d: Date): Date {
  const base = startOfDay(d);
  const dow = (base.getDay() + 6) % 7; // 周一=0
  return new Date(base.getTime() - dow * DAY);
}

/** 周键：该周周一的 YYYY-MM-DD，用于唯一标识一周 */
export function weekKeyOf(d: Date): string {
  const m = mondayOf(d);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${m.getFullYear()}-${pad(m.getMonth() + 1)}-${pad(m.getDate())}`;
}

/** 当前这一周的周键 */
export function currentWeekKey(): string {
  return weekKeyOf(new Date());
}

/** 上一周的周键 */
export function lastWeekKey(): string {
  return weekKeyOf(new Date(mondayOf(new Date()).getTime() - DAY));
}

/** 判断某 ISO 时间是否落在指定周键所在周内 */
export function isInWeek(iso: string, key: string): boolean {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  return weekKeyOf(new Date(t)) === key;
}

/** 周内某天（0=周一…6=周日），用于按周几筛选 */
export function weekdayIndex(iso: string): number {
  const d = new Date(iso);
  return (d.getDay() + 6) % 7;
}

/**
 * 推荐时间展示：如「6月5号本周五」。
 * 同周加「本周」、上周加「上周」、下周加「下周」前缀；更远则用「(周X)」。
 */
export function formatRecommendTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const dayName = DAY_NAMES[d.getDay()];
  const thisWeek = currentWeekKey();
  const key = weekKeyOf(d);
  if (key === thisWeek) return `${m}月${day}号本周${dayName}`;
  if (key === lastWeekKey()) return `${m}月${day}号上周${dayName}`;
  const nextKey = weekKeyOf(new Date(mondayOf(new Date()).getTime() + 7 * DAY));
  if (key === nextKey) return `${m}月${day}号下周${dayName}`;
  return `${m}月${day}号(周${dayName})`;
}

/** 简短日期：6月5号周五（用于列表日期分隔） */
export function formatDayHeader(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return formatRecommendTime(iso) || `${d.getMonth() + 1}月${d.getDate()}号周${DAY_NAMES[d.getDay()]}`;
}

/** 去掉文件后缀，得到「姓名-岗位」展示名 */
export function displayName(it: RepushItem): string {
  return it.fileName.replace(/\.(pdf|docx?)$/i, '').trim();
}

/**
 * 生成未反馈清单文本。
 * 格式：
 *   未反馈清单（本周）：
 *   1、姓名-岗位——编制-部门
 *   2、姓名-岗位——编制-部门（6号已面试）
 * 已约面/已面试的条目，追加「X号已面试」。
 */
export function buildUnfeedbackList(items: RepushItem[], title: string): string {
  const pending = items.filter((it) => it.feedback === 'pending');
  if (!pending.length) return '';
  const lines = pending.map((it, i) => {
    const base = displayName(it);
    const org = it.organization || '';
    const dept = it.department || '';
    let line = `${i + 1}、${base}——${org}-${dept}`;
    if (it.interviewAt) {
      const d = new Date(it.interviewAt);
      if (!Number.isNaN(d.getTime())) line += `（${d.getDate()}号已面试）`;
    }
    return line;
  });
  return [title, ...lines].join('\n');
}
