import Link from "next/link";
import { notFound } from "next/navigation";
import { createPublicClient } from "@/lib/supabase/public";
import { ScoreCard } from "@/components/m/ScoreCard";
import {
  formatWan,
  formatDiscount,
  formatArea,
  PROPERTY_TYPE_LABEL,
  TITLE_STATUS_LABEL,
  VERIFY_STATUS_LABEL,
} from "@/lib/format";
import type { PublicProperty } from "@/types/db";

export const dynamic = "force-dynamic";

export default async function MobileDetailPage({ params }: { params: { id: string } }) {
  const supabase = createPublicClient();
  const { data } = await supabase.from("public_properties").select("*").eq("id", params.id).single();
  if (!data) notFound();
  const p = data as PublicProperty;

  const facts: Array<[string, string]> = [
    ["物业类型", PROPERTY_TYPE_LABEL[p.property_type]],
    ["建筑面积", formatArea(p.area_sqm)],
    ["户型", p.layout ?? "—"],
    ["楼层", p.floor_info ?? "—"],
    ["产权状态", TITLE_STATUS_LABEL[p.title_status]],
    ["核验状态", VERIFY_STATUS_LABEL[p.verify_status]],
  ];

  return (
    <div className="yfp-m">
      <main className="m-wrap">
        <header className="m-bar">
          <Link href="/m" className="back">
            ←
          </Link>
          <b>房源详情</b>
        </header>

        <div className="m-detail">
          <div className="m-dtitle">
            <h1>{p.title}</h1>
            <p>{[p.district, p.community].filter(Boolean).join(" · ")}</p>
          </div>

          <div className="m-panel">
            <div className="m-pricerow">
              <b>
                {p.listing_price ?? "—"}
                <small>万</small>
              </b>
              {formatDiscount(p.discount_rate) ? (
                <span className="m-disc">{formatDiscount(p.discount_rate)}</span>
              ) : null}
            </div>
            {p.reference_price != null ? (
              <p className="m-refprice">市场参考价 {formatWan(p.reference_price)}</p>
            ) : null}
          </div>

          <ScoreCard score={p.sun_score} />

          <div className="m-panel">
            <h3>房源信息</h3>
            <dl className="m-facts">
              {facts.map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </div>

          <p className="m-note">
            免责声明：本平台仅提供房源信息撮合服务，所有信息以实地核验及政府部门登记为准。平台不参与任何资金往来，不提供贷款、放款或收益承诺。请买卖双方自行核实并谨慎交易。
          </p>
        </div>

        <div className="m-actionbar">
          <Link href={`/m/demand?from=${p.id}`} className="m-action-ghost">
            咨询顾问
          </Link>
          <Link href={`/m/demand?from=${p.id}&intent=want`} className="m-action-primary">
            我要这套
          </Link>
        </div>
      </main>
    </div>
  );
}
