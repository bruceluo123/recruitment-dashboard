import Link from "next/link";
import { formatDiscount, formatArea, PROPERTY_TYPE_LABEL } from "@/lib/format";
import type { PublicProperty } from "@/types/db";

export function MiniPropertyCard({ p }: { p: PublicProperty }) {
  const hot = p.sun_score >= 80;
  const meta = [p.district, p.community, PROPERTY_TYPE_LABEL[p.property_type], formatArea(p.area_sqm)]
    .filter(Boolean)
    .join(" · ");
  return (
    <Link href={`/m/p/${p.id}`} className="m-card">
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
}
