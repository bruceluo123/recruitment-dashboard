import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { CUSTOMER_TYPE_LABEL, formatDate } from "@/lib/format";
import type { Customer } from "@/types/db";

export const dynamic = "force-dynamic";

const TYPE_TABS = [
  { value: "", label: "全部" },
  { value: "buyer", label: "买家" },
  { value: "owner", label: "业主" },
  { value: "channel", label: "渠道" },
  { value: "bank", label: "银行" },
];

const TYPE_PILL: Record<string, string> = {
  buyer: "pill-info",
  owner: "pill-ok",
  channel: "pill-warn",
  bank: "pill-red",
  other: "pill-muted",
};

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: { type?: string; q?: string };
}) {
  const supabase = createClient();
  let query = supabase.from("customers").select("*").order("created_at", { ascending: false });
  if (searchParams.type) query = query.eq("customer_type", searchParams.type);
  if (searchParams.q) {
    const q = searchParams.q;
    query = query.or(`name.ilike.%${q}%,phone.ilike.%${q}%,wechat_name.ilike.%${q}%`);
  }
  const { data, error } = await query;
  const customers = (data ?? []) as Customer[];

  return (
    <div>
      <div className="yfp-page-head mb-[22px] flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1>客户 CRM</h1>
          <p>共 {customers.length} 位客户 · 买家 / 业主 / 渠道 / 银行统一管理</p>
        </div>
        <Link href="/admin/customers/import" className="yfp-btn yfp-btn-primary">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path d="M12 3v12m0 0 4-4m-4 4-4-4" />
            <path d="M5 21h14" />
          </svg>
          CSV 批量导入
        </Link>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap gap-2">
          {TYPE_TABS.map((t) => {
            const active = (searchParams.type ?? "") === t.value;
            const href = t.value ? `/admin/customers?type=${t.value}` : "/admin/customers";
            return (
              <Link key={t.value} href={href} className={`yfp-chip ${active ? "on" : ""}`}>
                {t.label}
              </Link>
            );
          })}
        </div>
        <form className="yfp-search-inline">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4-4" />
          </svg>
          <input name="q" defaultValue={searchParams.q ?? ""} placeholder="搜索姓名 / 手机 / 微信" />
          {searchParams.type ? <input type="hidden" name="type" value={searchParams.type} /> : null}
        </form>
      </div>

      {error ? (
        <p className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">加载失败：{error.message}</p>
      ) : null}

      <div className="yfp-tbl-wrap">
        <table className="yfp-tbl">
          <thead>
            <tr>
              <th>姓名</th>
              <th>手机号</th>
              <th>类型</th>
              <th>标签</th>
              <th>创建时间</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.id}>
                <td>
                  <Link href={`/admin/customers/${c.id}`} className="h-title hover:underline">
                    {c.name || c.wechat_name || "未命名"}
                  </Link>
                </td>
                <td className="tabular">{c.phone || "—"}</td>
                <td>
                  <span className={`yfp-pill ${TYPE_PILL[c.customer_type] ?? "pill-muted"}`}>
                    {CUSTOMER_TYPE_LABEL[c.customer_type] ?? c.customer_type}
                  </span>
                </td>
                <td>
                  <div className="flex flex-wrap gap-1">
                    {c.tags.map((t) => (
                      <span key={t} className="yfp-chip sm">{t}</span>
                    ))}
                  </div>
                </td>
                <td className="text-[#9A8D7E]">{formatDate(c.created_at)}</td>
              </tr>
            ))}
            {customers.length === 0 ? (
              <tr>
                <td colSpan={5} className="yfp-empty">暂无客户，点击右上角导入。</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
