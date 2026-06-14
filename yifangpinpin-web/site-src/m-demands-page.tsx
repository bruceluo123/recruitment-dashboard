import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getBuyer } from "@/lib/buyer";
import type { BuyerDemand } from "@/types/db";

export const dynamic = "force-dynamic";
export const metadata = { title: "我的需求 · 易房拼拼" };

const PURPOSE_LABEL: Record<string, string> = {
  self_use: "自住",
  invest: "投资",
  finance: "资金周转",
};
const STATUS_LABEL: Record<string, string> = {
  open: "顾问跟进中",
  matched: "已匹配房源",
  closed: "已关闭",
};

function budgetText(d: BuyerDemand): string {
  if (d.budget_min && d.budget_max) return `${d.budget_min}–${d.budget_max} 万`;
  if (d.budget_max) return `≤ ${d.budget_max} 万`;
  if (d.budget_min) return `≥ ${d.budget_min} 万`;
  return "预算待沟通";
}

export default async function MyDemandsPage() {
  const buyer = await getBuyer();
  if (!buyer) redirect("/m/login?redirect=/m/account/demands");

  let demands: BuyerDemand[] = [];
  if (buyer.phone) {
    const admin = createAdminClient();
    const { data: customer } = await admin
      .from("customers")
      .select("id")
      .eq("phone", buyer.phone)
      .maybeSingle();
    if (customer) {
      const { data } = await admin
        .from("buyer_demands")
        .select("*")
        .eq("customer_id", customer.id)
        .order("created_at", { ascending: false });
      demands = (data ?? []) as BuyerDemand[];
    }
  }

  return (
    <div className="yfp-m">
      <main className="m-wrap">
        <header className="m-bar">
          <Link href="/m/account" className="back">
            ←
          </Link>
          <b>我的需求</b>
        </header>

        <div className="m-demand-list">
          {demands.map((d) => (
            <div key={d.id} className="m-demand-item">
              <div className="m-demand-top">
                <b>{budgetText(d)}</b>
                <span className={`m-demand-st st-${d.status}`}>{STATUS_LABEL[d.status] ?? d.status}</span>
              </div>
              <p className="m-demand-meta">
                {PURPOSE_LABEL[d.purpose] ?? d.purpose}
                {d.districts.length ? ` · ${d.districts.join("，")}` : ""}
              </p>
              {d.raw_note ? <p className="m-demand-note">{d.raw_note}</p> : null}
              <span className="m-demand-date">{new Date(d.created_at).toLocaleDateString("zh-CN")}</span>
            </div>
          ))}
          {demands.length === 0 ? (
            <div className="m-empty-box">
              <p>还没有登记购房需求</p>
              <Link href="/m/demand" className="m-back">
                登记购房需求
              </Link>
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}
