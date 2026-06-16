// 房产金融贷款模块 · 类型与展示工具。金额单位：万元；利率为年化百分数。

export type LoanType =
  | "mortgage_buy"
  | "mortgage_biz"
  | "mortgage_consume"
  | "provident"
  | "other";

export interface PublicLoanProduct {
  id: string;
  name: string;
  bank_name: string;
  loan_type: LoanType;
  rate_min: number | null;
  rate_max: number | null;
  amount_max: number | null;
  term_max_years: number | null;
  ltv_max: number | null;
  highlight: string | null;
  requirements: string[];
  sort_order: number;
}

export const LOAN_TYPE_LABEL: Record<LoanType, string> = {
  mortgage_buy: "按揭购房",
  mortgage_biz: "房抵经营贷",
  mortgage_consume: "房抵消费贷",
  provident: "公积金贷款",
  other: "其他贷款",
};

// C 端贷款类型筛选 tab
export const LOAN_TYPE_TABS: { value: string; label: string }[] = [
  { value: "", label: "全部" },
  { value: "mortgage_buy", label: "按揭购房" },
  { value: "mortgage_biz", label: "房抵经营贷" },
  { value: "mortgage_consume", label: "房抵消费贷" },
  { value: "provident", label: "公积金" },
];

// 五不原则——撮合合规底线，贯穿全模块展示
export const FIVE_NO = ["不放贷", "不募集", "不担保", "不触碰资金", "不虚假承诺"];

// 利率展示：3.05 → "3.05%"；区间 3.05/3.40 → "3.05%–3.40%"
export function formatRate(min: number | null, max: number | null): string {
  if (min == null && max == null) return "利率面议";
  if (min != null && max != null && min !== max) return `${min}%–${max}%`;
  const v = min ?? max;
  return `${v}%`;
}

// 额度展示：1000 → "最高 1000 万"
export function formatLoanAmount(amount: number | null): string | null {
  if (amount == null) return null;
  return `最高 ${amount} 万`;
}

export function formatTerm(years: number | null): string | null {
  if (years == null) return null;
  return `最长 ${years} 年`;
}

export function formatLtv(ltv: number | null): string | null {
  if (ltv == null) return null;
  return `${ltv} 成`;
}
