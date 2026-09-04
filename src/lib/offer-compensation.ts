import type { OfferJobLevel } from '@/types/interview';

export interface OfferGrade {
  level: OfferJobLevel;
  score: number;
}

/** 兼容 30000、30K、3万、30,000 人民币/月等常见薪资写法。 */
export function parseMonthlySalary(value?: string): number | null {
  if (!value) return null;
  const normalized = value.trim().replace(/,/g, '');
  const match = normalized.match(/(\d+(?:\.\d+)?)\s*(k|千|w|万)?/i);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  const unit = match[2]?.toLowerCase();
  if (unit === 'k' || unit === '千') return amount * 1000;
  if (unit === 'w' || unit === '万') return amount * 10000;
  return amount;
}

/** 按招聘绩效奖金标准，用转正月薪自动计算岗位等级和分数。 */
export function getOfferGrade(regularSalary?: string): OfferGrade | null {
  const salary = parseMonthlySalary(regularSalary);
  if (salary === null || salary < 0) return null;
  if (salary < 10_000) return { level: '初级', score: 1 };
  if (salary < 12_000) return { level: '一级', score: 1.2 };
  if (salary < 15_000) return { level: '一级', score: 1.5 };
  if (salary < 20_000) return { level: '二级', score: 2 };
  if (salary < 25_000) return { level: '三级', score: 2.5 };
  if (salary < 30_000) return { level: '三级', score: 3 };
  if (salary < 35_000) return { level: '四级', score: 3.5 };
  if (salary < 40_000) return { level: '四级', score: 5 };
  return { level: '五级', score: 6 };
}
