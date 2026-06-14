import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createPublicClient } from "@/lib/supabase/public";
import { getBuyer } from "@/lib/buyer";
import { MiniPropertyCard } from "@/components/m/MiniPropertyCard";
import type { PublicProperty } from "@/types/db";

export const dynamic = "force-dynamic";
export const metadata = { title: "浏览历史 · 易房拼拼" };

export default async function HistoryPage() {
  const buyer = await getBuyer();
  if (!buyer) redirect("/m/login?redirect=/m/account/history");

  const supabase = createClient();
  const { data: rows } = await supabase
    .from("browse_history")
    .select("property_id")
    .eq("user_id", buyer.id)
    .order("viewed_at", { ascending: false })
    .limit(50);

  const ids = (rows ?? []).map((r) => r.property_id as string);
  let list: PublicProperty[] = [];
  if (ids.length) {
    const pub = createPublicClient();
    const { data } = await pub.from("public_properties").select("*").in("id", ids);
    const byId = new Map((data ?? []).map((p) => [p.id, p as PublicProperty]));
    list = ids.map((id) => byId.get(id)).filter(Boolean) as PublicProperty[];
  }

  return (
    <div className="yfp-m">
      <main className="m-wrap">
        <header className="m-bar">
          <Link href="/m/account" className="back">
            ←
          </Link>
          <b>浏览历史</b>
        </header>

        <div className="m-list">
          {list.map((p) => (
            <MiniPropertyCard key={p.id} p={p} />
          ))}
          {list.length === 0 ? (
            <div className="m-empty-box">
              <p>还没有浏览记录</p>
              <Link href="/m" className="m-back">
                去发现笋盘
              </Link>
            </div>
          ) : null}
        </div>
      </main>
    </div>
  );
}
