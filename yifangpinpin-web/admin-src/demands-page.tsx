import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { DemandMatchButton } from "@/components/admin/DemandMatchButton";

export const dynamic = "force-dynamic";

const PURPOSE_LABEL: Record<string, string> = {
  self_use: "自住", invest: "投资", finance: "资金周转",
};
const STATUS_LABEL: Record<string, string> = {
  open: "待匹配", matched: "已匹配", closed: "已关闭",
};
const STATUS_PILL: Record<string, string> = {
  open: "pill-warn", matched: "pill-ok", closed: "pill-muted",
};
const STATUS_TABS = [
  { value: "", label: "全部" },
  { value: "open", label: "待匹配" },
  { value: "matched", label: "已匹配" },
  { value: "closed", label: "已关闭" },
];

interface DemandRow {
  id: string;
  budget_min: number | null;
  budget_max: number | null;
  districts: string[];
  purpose: string;
  status: string;
  raw_note: string | null;
  created_at: string;
  customers: { name: string | null; phone: string | null } | null;
}

export default async function DemandsPage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const supabase = createClient();
  let query = supabase
    .from("buyer_demands")
    .select("*, customers(name, phone)")
    .order("created_at", { ascending: false });
  if (searchParams.status) query = query.eq("status", searchParams.status);
  const { data, error } = await query;
  const demands = (data ?? []) as unknown as DemandRow[];
  const openCount = demands.filter((d) => d.status === "open").length;

  return (
    <div>
      <div className="yfp-page-head mb-[22px] flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1>需求池</h1>
          <p>共 {demands.length} 条买家需求 · 待匹配 {openCount} 条 · AI 智能匹配房源</p>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {STATUS_TABS.map((t) => {
          const active = (searchParams.status ?? "") === t.value;
          const href = t.value ? `/admin/demands?status=${t.value}` : "/admin/demands";
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
              <th>预算 (万)</th>
              <th>意向区域</th>
              <th>目的</th>
              <th>状态</th>
              <th className="text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {demands.map((d) => (
              <tr key={d.id}>
                <td>
                  <div className="h-title">{d.customers?.name || "未命名"}</div>
                  <div className="h-loc">{d.customers?.phone || ""}</div>
                </td>
                <td className="yfp-price">
                  <b>{d.budget_min ?? "?"}–{d.budget_max ?? "?"}</b>
                </td>
                <td className="text-[#6B5F54]">{d.districts.join("、") || "不限"}</td>
                <td>
                  <span className="yfp-pill pill-info">{PURPOSE_LABEL[d.purpose] ?? d.purpose}</span>
                </td>
                <td>
                  <span className={`yfp-pill ${STATUS_PILL[d.status] ?? "pill-muted"}`}>
                    {STATUS_LABEL[d.status] ?? d.status}
                  </span>
                </td>
                <td>
                  <div className="yfp-act justify-end">
                    <DemandMatchButton demandId={d.id} />
                  </div>
                </td>
              </tr>
            ))}
            {demands.length === 0 ? (
              <tr>
                <td colSpan={6} className="yfp-empty">暂无需求。</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
