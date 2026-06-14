import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  formatWan,
  PROPERTY_STATUS_LABEL,
  PROPERTY_TYPE_LABEL,
  VERIFY_STATUS_LABEL,
} from "@/lib/format";
import type { Property } from "@/types/db";
import { SunRing } from "@/components/admin/SunRing";
import { deleteProperty } from "./actions";

export const dynamic = "force-dynamic";

const STATUS_PILL: Record<string, string> = {
  on_sale: "pill-ok",
  reserved: "pill-info",
  sold: "pill-muted",
  offline: "pill-warn",
};
const VERIFY_PILL: Record<string, string> = {
  verified: "pill-ok",
  pending: "pill-warn",
  unverified: "pill-muted",
};

export default async function PropertiesPage() {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("properties")
    .select("*")
    .order("sun_score", { ascending: false });

  const properties = (data ?? []) as Property[];
  const onSale = properties.filter((p) => p.status === "on_sale").length;

  return (
    <div>
      <div className="yfp-page-head mb-[22px] flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1>房源管理</h1>
          <p>
            共 {properties.length} 套 · 在售 {onSale} 套 · 自动笋度评分
          </p>
        </div>
        <div className="flex gap-2.5">
          <Link href="/admin/customers/import" className="yfp-btn yfp-btn-ghost">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M12 3v12m0 0 4-4m-4 4-4-4" />
              <path d="M5 21h14" />
            </svg>
            批量导入
          </Link>
          <Link href="/admin/properties/new" className="yfp-btn yfp-btn-primary">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M12 5v14M5 12h14" />
            </svg>
            录入新房源
          </Link>
        </div>
      </div>

      {error ? (
        <p className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
          加载失败：{error.message}（请确认已配置 Supabase 环境变量）
        </p>
      ) : null}

      <div className="yfp-tbl-wrap">
        <table className="yfp-tbl">
          <thead>
            <tr>
              <th>房源</th>
              <th>类型</th>
              <th>面积</th>
              <th>挂牌价</th>
              <th>笋度</th>
              <th>状态</th>
              <th>核验</th>
              <th className="text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {properties.map((p) => (
              <tr key={p.id}>
                <td>
                  <div className="yfp-cell-house">
                    <span className="yfp-thumb">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                        <path d="M3 10.5 12 3l9 7.5" />
                        <path d="M5 9.5V21h14V9.5" />
                      </svg>
                    </span>
                    <div>
                      <div className="h-title">{p.title}</div>
                      <div className="h-loc">
                        {[p.district, p.community, p.layout].filter(Boolean).join(" · ") || "—"}
                      </div>
                    </div>
                  </div>
                </td>
                <td>
                  <span className="yfp-pill pill-info">{PROPERTY_TYPE_LABEL[p.property_type] ?? p.property_type}</span>
                </td>
                <td className="tabular">{p.area_sqm ? `${p.area_sqm} ㎡` : "—"}</td>
                <td className="yfp-price">
                  <b>{formatWan(p.listing_price)}</b>
                  {p.reference_price ? <s>{formatWan(p.reference_price)}</s> : null}
                </td>
                <td>
                  <div className="yfp-sun">
                    <SunRing score={p.sun_score} />
                  </div>
                </td>
                <td>
                  <span className={`yfp-pill ${STATUS_PILL[p.status] ?? "pill-muted"}`}>
                    {PROPERTY_STATUS_LABEL[p.status] ?? p.status}
                  </span>
                </td>
                <td>
                  <span className={`yfp-pill ${VERIFY_PILL[p.verify_status] ?? "pill-muted"}`}>
                    {VERIFY_STATUS_LABEL[p.verify_status] ?? p.verify_status}
                  </span>
                </td>
                <td>
                  <div className="yfp-act justify-end">
                    <Link href={`/admin/properties/${p.id}`} className="yfp-ib" title="编辑">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path d="M12 20h9" />
                        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
                      </svg>
                    </Link>
                    <form action={deleteProperty.bind(null, p.id)}>
                      <button type="submit" className="yfp-ib" title="删除">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                          <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                        </svg>
                      </button>
                    </form>
                  </div>
                </td>
              </tr>
            ))}
            {properties.length === 0 ? (
              <tr>
                <td colSpan={8} className="yfp-empty">
                  暂无房源，点击右上角录入。
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
