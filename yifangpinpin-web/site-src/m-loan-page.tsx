import Link from "next/link";
import { createPublicClient } from "@/lib/supabase/public";
import { getBuyer } from "@/lib/buyer";
import {
  LOAN_TYPE_LABEL,
  LOAN_TYPE_TABS,
  FIVE_NO,
  formatRate,
  formatLoanAmount,
  formatTerm,
  type PublicLoanProduct,
} from "@/lib/loan";

export const dynamic = "force-dynamic";
export const metadata = { title: "房产金融 · 易房拼拼" };

export default async function LoanListPage({
  searchParams,
}: {
  searchParams: { type?: string };
}) {
  const supabase = createPublicClient();
  let query = supabase
    .from("public_loan_products")
    .select("*")
    .order("sort_order", { ascending: true });
  if (searchParams.type) query = query.eq("loan_type", searchParams.type);
  const { data } = await query;
  const list = (data ?? []) as PublicLoanProduct[];
  const buyer = await getBuyer();

  return (
    <div className="yfp-m">
      <main className="m-wrap m-wrap-loan">
        <header className="m-hero m-hero-loan">
          <div className="m-hero-brand">
            <img src="/assets/logo.png" alt="易房拼拼" width={34} height={34} />
            <b>易房拼拼</b>
            <div className="m-hero-nav">
              <Link href="/m" className="m-hero-home">
                看笋盘
              </Link>
              <Link href={buyer ? "/m/account" : "/m/login"} className="m-hero-me">
                {buyer ? "我的" : "登录"}
              </Link>
            </div>
          </div>
          <h1>房产金融撮合</h1>
          <p>对接持牌银行 · 帮你匹配更低利率方案</p>
          <div className="m-fivelaw">
            {FIVE_NO.map((t) => (
              <span key={t} className="m-fivelaw-chip">
                {t}
              </span>
            ))}
          </div>
        </header>

        <div className="m-tabs">
          {LOAN_TYPE_TABS.map((t) => {
            const active = (searchParams.type ?? "") === t.value;
            const href = t.value ? `/m/loan?type=${t.value}` : "/m/loan";
            return (
              <Link key={t.value} href={href} className={`m-tab ${active ? "on" : ""}`}>
                {t.label}
              </Link>
            );
          })}
        </div>

        <div className="m-loan-list">
          {list.map((p) => {
            const tags = [formatLoanAmount(p.amount_max), formatTerm(p.term_max_years)].filter(
              Boolean,
            ) as string[];
            return (
              <Link key={p.id} href={`/m/loan/${p.id}`} className="m-loan-card">
                <div className="m-loan-top">
                  <span className="m-loan-type">{LOAN_TYPE_LABEL[p.loan_type]}</span>
                  <div className="m-loan-rate">
                    <b>{formatRate(p.rate_min, p.rate_max)}</b>
                    <em>年化起</em>
                  </div>
                </div>
                <h2>{p.name}</h2>
                <p className="m-loan-bank">{p.bank_name}</p>
                {p.highlight ? <p className="m-loan-hl">{p.highlight}</p> : null}
                {tags.length ? (
                  <div className="m-loan-tags">
                    {tags.map((t) => (
                      <span key={t}>{t}</span>
                    ))}
                  </div>
                ) : null}
              </Link>
            );
          })}
          {list.length === 0 ? <p className="m-empty">暂无符合条件的贷款产品</p> : null}
        </div>

        <div className="m-loan-cta">
          <p>不确定自己适合哪款？留下需求，顾问免费帮你测算</p>
          <Link href="/m/loan/apply" className="m-loan-cta-btn">
            免费贷款咨询
          </Link>
        </div>

        <p className="m-loan-disclaimer">
          本页产品信息仅供撮合参考，最终利率、额度与审批结果以银行/机构为准。平台严守
          「不放贷、不募集、不担保、不触碰资金、不虚假承诺」原则，仅提供信息对接服务，不涉及任何资金往来。
        </p>
      </main>
    </div>
  );
}
