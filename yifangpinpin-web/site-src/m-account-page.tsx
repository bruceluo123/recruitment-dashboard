import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getBuyer, maskPhone } from "@/lib/buyer";
import { logoutBuyer } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "我的 · 易房拼拼" };

export default async function AccountPage() {
  const buyer = await getBuyer();
  if (!buyer) redirect("/m/login?redirect=/m/account");

  const supabase = createClient();
  const [{ count: favCount }, { count: histCount }] = await Promise.all([
    supabase.from("favorites").select("id", { count: "exact", head: true }).eq("user_id", buyer.id),
    supabase.from("browse_history").select("id", { count: "exact", head: true }).eq("user_id", buyer.id),
  ]);

  let demandCount = 0;
  if (buyer.phone) {
    const admin = createAdminClient();
    const { data: customer } = await admin
      .from("customers")
      .select("id")
      .eq("phone", buyer.phone)
      .maybeSingle();
    if (customer) {
      const { count } = await admin
        .from("buyer_demands")
        .select("id", { count: "exact", head: true })
        .eq("customer_id", customer.id);
      demandCount = count ?? 0;
    }
  }

  const entries: Array<[string, string, number]> = [
    ["房源收藏", "/m/account/favorites", favCount ?? 0],
    ["我的需求", "/m/account/demands", demandCount],
    ["浏览历史", "/m/account/history", histCount ?? 0],
    ["个人资料", "/m/account/profile", -1],
  ];

  return (
    <div className="yfp-m">
      <main className="m-wrap">
        <header className="m-account-hero">
          <div className="m-avatar">{buyer.nickname.slice(0, 1)}</div>
          <div className="m-account-id">
            <b>{buyer.nickname}</b>
            <span>{maskPhone(buyer.phone)}</span>
          </div>
        </header>

        <nav className="m-account-grid">
          {entries.map(([label, href, count]) => (
            <Link key={href} href={href} className="m-account-cell">
              <b>{label}</b>
              {count >= 0 ? <em>{count}</em> : <span className="arrow">›</span>}
            </Link>
          ))}
        </nav>

        <div className="m-account-actions">
          <Link href="/m" className="m-back">
            返回首页看房
          </Link>
          <form action={logoutBuyer}>
            <button type="submit" className="m-logout">
              退出登录
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
