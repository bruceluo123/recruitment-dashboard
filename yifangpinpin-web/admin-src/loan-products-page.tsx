import { createClient } from "@/lib/supabase/server";
import {
  LOAN_TYPE_LABEL,
  formatRate,
  formatLoanAmount,
  formatTerm,
  formatLtv,
  type LoanType,
} from "@/lib/loan";

export const dynamic = "force-dynamic";

interface ProductRow {
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
  sort_order: number | null;
  is_active: boolean;
}

export default async function LoanProductsPage() {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("loan_products")
    .select("*")
    .order("sort_order", { ascending: true });
  const products = (data ?? []) as unknown as ProductRow[];
  const activeCount = products.filter((p) => p.is_active).length;

  return (
    <div>
      <div className="yfp-page-head mb-[22px] flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1>贷款产品</h1>
          <p>共 {products.length} 款产品 · 在架 {activeCount} 款 · 纯信息撮合，不放贷不触碰资金</p>
        </div>
      </div>

      {error ? (
        <p className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">加载失败：{error.message}</p>
      ) : null}

      <div className="yfp-tbl-wrap">
        <table className="yfp-tbl">
          <thead>
            <tr>
              <th>产品 / 银行</th>
              <th>类型</th>
              <th>年化利率</th>
              <th>最高额度</th>
              <th>年限 / 成数</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id}>
                <td>
                  <div className="h-title">{p.name}</div>
                  <div className="h-loc">{p.bank_name}</div>
                </td>
                <td>
                  <span className="yfp-pill pill-info">{LOAN_TYPE_LABEL[p.loan_type] ?? p.loan_type}</span>
                </td>
                <td className="yfp-price">
                  <b>{formatRate(p.rate_min, p.rate_max) || "—"}</b>
                </td>
                <td className="text-[#6B5F54]">{formatLoanAmount(p.amount_max) || "—"}</td>
                <td className="text-[#6B5F54]">
                  {[formatTerm(p.term_max_years), formatLtv(p.ltv_max)].filter(Boolean).join(" · ") || "—"}
                </td>
                <td>
                  <span className={`yfp-pill ${p.is_active ? "pill-ok" : "pill-muted"}`}>
                    {p.is_active ? "在架" : "已下架"}
                  </span>
                </td>
              </tr>
            ))}
            {products.length === 0 ? (
              <tr>
                <td colSpan={6} className="yfp-empty">暂无产品。请在数据库 seed 公开银行产品。</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
