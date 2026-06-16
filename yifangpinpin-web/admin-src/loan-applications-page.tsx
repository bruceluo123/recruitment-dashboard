import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { LOAN_TYPE_LABEL, type LoanType } from "@/lib/loan";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  open: "待联系", contacted: "已联系", closed: "已关闭",
};
const STATUS_PILL: Record<string, string> = {
  open: "pill-warn", contacted: "pill-ok", closed: "pill-muted",
};
const STATUS_TABS = [
  { value: "", label: "全部" },
  { value: "open", label: "待联系" },
  { value: "contacted", label: "已联系" },
  { value: "closed", label: "已关闭" },
];

interface AppRow {
  id: string;
  name: string | null;
  phone: string;
  loan_type: LoanType | null;
  amount_wanted: number | null;
  property_value: number | null;
  has_property: boolean | null;
  note: string | null;
  status: string;
  source: string | null;
  created_at: string;
  customers: { name: string | null; phone: string | null } | null;
  loan_products: { name: string | null } | null;
}

export default async function LoanApplicationsPage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const supabase = createClient();
  let query = supabase
    .from("loan_applications")
    .select("*, customers(name, phone), loan_products(name)")
    .order("created_at", { ascending: false });
  if (searchParams.status) query = query.eq("status", searchParams.status);
  const { data, error } = await query;
  const apps = (data ?? []) as unknown as AppRow[];
  const openCount = apps.filter((a) => a.status === "open").length;

  return (
    <div>
      <div className="yfp-page-head mb-[22px] flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1>贷款咨询</h1>
          <p>共 {apps.length} 条咨询 · 待联系 {openCount} 条 · 仅撮合对接，不涉及资金往来</p>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {STATUS_TABS.map((t) => {
          const active = (searchParams.status ?? "") === t.value;
          const href = t.value ? `/admin/loan-applications?status=${t.value}` : "/admin/loan-applications";
          return (
            <Link key={t.value} href={href} className={`yfp-chip ${active ? "on" : ""}`}>
              {t.label}
            </Link>
          );
        })}
      </div>

      {error ? (
        <p className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">加载失败：{error.message}</p>
      ) : null}

      <div className="yfp-tbl-wrap">
        <table className="yfp-tbl">
          <thead>
            <tr>
              <th>客户</th>
              <th>咨询产品</th>
              <th>类型</th>
              <th>期望额度 / 房产估值 (万)</th>
              <th>有房</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {apps.map((a) => (
              <tr key={a.id}>
                <td>
                  <div className="h-title">{a.name || a.customers?.name || "未命名"}</div>
                  <div className="h-loc">{a.phone || a.customers?.phone || ""}</div>
                </td>
                <td className="text-[#6B5F54]">{a.loan_products?.name || "顾问推荐"}</td>
                <td>
                  {a.loan_type ? (
                    <span className="yfp-pill pill-info">{LOAN_TYPE_LABEL[a.loan_type] ?? a.loan_type}</span>
                  ) : (
                    <span className="yfp-pill pill-muted">未定</span>
                  )}
                </td>
                <td className="yfp-price">
                  <b>{a.amount_wanted ?? "?"}</b> / {a.property_value ?? "?"}
                </td>
                <td>
                  <span className={`yfp-pill ${a.has_property ? "pill-ok" : "pill-muted"}`}>
                    {a.has_property ? "有房" : "无/不确定"}
                  </span>
                </td>
                <td>
                  <span className={`yfp-pill ${STATUS_PILL[a.status] ?? "pill-muted"}`}>
                    {STATUS_LABEL[a.status] ?? a.status}
                  </span>
                </td>
              </tr>
            ))}
            {apps.length === 0 ? (
              <tr>
                <td colSpan={6} className="yfp-empty">暂无咨询。</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
