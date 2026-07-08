import type { JD } from '@/types/jd';

/**
 * 返回 N 个工作日前的零点时间。工作日 = 周一至周六（仅周日不算），
 * 用作「新」角标与「本周新增」的滚动窗口下界——天然跨周日、跨星期，不在周一被重置。
 */
export function workdayThreshold(workdays = 5, now: Date = new Date()): Date {
  const t = new Date(now);
  t.setHours(0, 0, 0, 0);
  let count = 0;
  while (count < workdays) {
    t.setDate(t.getDate() - 1);
    // 周日(0)不算工作日；周一至周六(1-6)都算 —— 公司工作时间为周一到周六。
    if (t.getDay() !== 0) count++;
  }
  return t;
}

/**
 * 最近 N 个工作日内新增的岗位（按 createdAt 判定，工作日含周六、仅跨周日，排除 mock 数据）。
 * 「新」角标与「本周新增」共用同一判定，保证两处始终一致。
 */
export function recentlyAddedJds(jds: JD[], workdays = 5, now: Date = new Date()): JD[] {
  const threshold = workdayThreshold(workdays, now);
  return jds.filter(
    (j) => !j.id.startsWith('jd-00') && !!j.createdAt && new Date(j.createdAt) >= threshold,
  );
}

/** 滚动窗口的可读区间标签，如「6月24日—6月29日」。 */
export function recentWindowLabel(workdays = 5, now: Date = new Date()): string {
  const start = workdayThreshold(workdays, now);
  const fmt = (d: Date) => `${d.getMonth() + 1}月${d.getDate()}日`;
  return `${fmt(start)}—${fmt(now)}`;
}
