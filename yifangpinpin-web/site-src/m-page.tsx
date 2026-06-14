import Link from "next/link";
import { createPublicClient } from "@/lib/supabase/public";
import { formatDiscount, formatArea, PROPERTY_TYPE_LABEL } from "@/lib/format";
import type { PublicProperty } from "@/types/db";

export const dynamic = "force-dynamic";
export const metadata = { title: "笋盘精选 · 易房拼拼" };

const TYPES = [
  { value: "", label: "全部" },
  { value: "residence", label: "住宅" },
  { value: "shop", label: "商铺" },
  { value: "office", label: "写字楼" },
  { value: "apartment", label: "公寓" },
];

export default async function MobileListPage({
  searchParams,
}: {
  searchParams: { type?: string; district?: string };
}) {
  const supabase = createPublicClient();
  let query = supabase.from("public_properties").select("*").order("sun_score", { ascending: false });
  if (searchParams.type) query = query.eq("property_type", searchParams.type);
  if (searchParams.district) query = query.ilike("district", `%${searchParams.district}%`);
  const { data } = await query;
  const list = (data ?? []) as PublicProperty[];

  return (
    <div className="yfp-m">
      <main className="m-wrap">
        <header className="m-hero">
          <div className="m-hero-brand">
            <img src="/assets/logo.png" alt="易房拼拼" width={34} height={34} />
            <b>易房拼拼</b>
          </div>
          <h1>笋盘精选</h1>
          <p>已核验真实房源 · 价格优势一目了然</p>
          <form className="m-search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4-4" />
            </svg>
            <input name="district" defaultValue={searchParams.district ?? ""} placeholder="搜索区域，如 南山 / 福田" />
            {searchParams.type ? <input type="hidden" name="type" value={searchParams.type} /> : null}
            <button type="submit">搜索</button>
          </form>
        </header>

        <div className="m-tabs">
          {TYPES.map((t) => {
            const active = (searchParams.type ?? "") === t.value;
            const href = t.value ? `/m?type=${t.value}` : "/m";
            return (
              <Link key={t.value} href={href} className={`m-tab ${active ? "on" : ""}`}>
                {t.label}
              </Link>
            );
          })}
        </div>

        <div className="m-list">
          {list.map((p) => {
            const hot = p.sun_score >= 80;
            const meta = [p.district, p.community, PROPERTY_TYPE_LABEL[p.property_type], formatArea(p.area_sqm)]
              .filter(Boolean)
              .join(" · ");
            return (
              <Link key={p.id} href={`/m/p/${p.id}`} className="m-card">
                <div className="m-card-score">
                  <span className={`m-sun ${hot ? "hot" : ""}`}>
                    <b>{p.sun_score}</b>
                  </span>
                  <em>笋度</em>
                </div>
                <div className="m-card-body">
                  <span className="ptype">{PROPERTY_TYPE_LABEL[p.property_type]}</span>
                  <h2>{p.title}</h2>
                  <p className="loc">{meta}</p>
                  <div className="priceline">
                    <b>
                      {p.listing_price ?? "—"}
                      <small>万</small>
                    </b>
                    {formatDiscount(p.discount_rate) ? (
                      <span className="m-disc">{formatDiscount(p.discount_rate)}</span>
                    ) : null}
                  </div>
                </div>
              </Link>
            );
          })}
          {list.length === 0 ? <p className="m-empty">暂无符合条件的房源</p> : null}
        </div>
      </main>
    </div>
  );
}
