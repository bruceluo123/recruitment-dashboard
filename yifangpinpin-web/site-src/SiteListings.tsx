"use client";

import { useState } from "react";
import Link from "next/link";
import type { PublicProperty } from "@/types/db";

const TYPE_LABEL: Record<string, string> = {
  residence: "住宅",
  shop: "商铺",
  office: "写字楼",
  apartment: "公寓",
};

const FILTERS = [
  { value: "all", label: "全部" },
  { value: "residence", label: "住宅" },
  { value: "apartment", label: "公寓" },
  { value: "shop", label: "商铺" },
  { value: "office", label: "写字楼" },
];

function discount(price: number | null, ref: number | null): number | null {
  if (!price || !ref || ref <= price) return null;
  return Math.round(((ref - price) / ref) * 1000) / 10;
}

export function SiteListings({ listings }: { listings: PublicProperty[] }) {
  const [filter, setFilter] = useState("all");
  const visible = listings.filter((p) => filter === "all" || p.property_type === filter);

  return (
    <>
      <div className="filters">
        {FILTERS.map((f) => (
          <span
            key={f.value}
            className={`filt ${filter === f.value ? "on" : ""}`}
            onClick={() => setFilter(f.value)}
          >
            {f.label}
          </span>
        ))}
      </div>
      <div className="grid">
        {visible.map((p) => {
          const d = discount(p.listing_price, p.reference_price);
          const hot = p.sun_score >= 80;
          const meta = [
            p.district,
            p.community,
            p.layout,
            p.area_sqm ? `${p.area_sqm}㎡` : null,
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <Link key={p.id} className="card" href={`/m/p/${p.id}`}>
              <div className="card-top">
                <span className="sun">
                  <span className={`sun-pill ${hot ? "hot" : ""}`}>
                    <b>{p.sun_score}</b>
                    <span>笋度</span>
                  </span>
                </span>
                <span className="ptype">{TYPE_LABEL[p.property_type] ?? p.property_type}</span>
                <h4>{p.title}</h4>
                <div className="loc">{meta}</div>
              </div>
              <div className="card-body">
                <div className="price">
                  <b>{p.listing_price ?? "—"}</b>
                  <span className="u">万</span>
                  {p.reference_price && p.reference_price > (p.listing_price ?? 0) ? (
                    <s>市场价 {p.reference_price}万</s>
                  ) : null}
                </div>
                <div className="metaline">
                  {d ? (
                    <span className="discount">低于市场价 {d}%</span>
                  ) : (
                    <span className="chip">价格可议</span>
                  )}
                  {p.urgency_level >= 3 ? <span className="chip">业主急售</span> : null}
                  <span className="chip">已核验</span>
                </div>
              </div>
            </Link>
          );
        })}
        {visible.length === 0 ? (
          <p style={{ gridColumn: "1 / -1", textAlign: "center", color: "rgba(255,255,255,.6)", padding: "40px 0" }}>
            暂无该类型房源
          </p>
        ) : null}
      </div>
    </>
  );
}
