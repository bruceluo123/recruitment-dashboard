import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createPublicClient } from "@/lib/supabase/public";
import { getBuyer } from "@/lib/buyer";
import { MiniPropertyCard } from "@/components/m/MiniPropertyCard";
import type { PublicProperty } from "@/types/db";

export const dynamic = "force-dynamic";
export const metadata = { title: "我的收藏 · 易房拼拼" };

export default async function FavoritesPage() {
  const buyer = await getBuyer();
  if (!buyer) redirect("/m/login?redirect=/m/account/favorites");

  const supabase = createClient();
  const { data: favs } = await supabase
    .from("favorites")
    .select("property_id")
    .eq("user_id", buyer.id)
    .order("created_at", { ascending: false });

  const ids = (favs ?? []).map((f) => f.property_id as string);
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
          <b>我的收藏</b>
        </header>

        <div className="m-list">
          {list.map((p) => (
            <MiniPropertyCard key={p.id} p={p} />
          ))}
          {list.length === 0 ? (
            <div className="m-empty-box">
              <p>还没有收藏的房源</p>
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
