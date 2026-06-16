import Link from "next/link";
import { notFound } from "next/navigation";
import { createPublicClient } from "@/lib/supabase/public";
import { getBuyer } from "@/lib/buyer";
import {
  LOAN_TYPE_LABEL,
  formatRate,
  formatLoanAmount,
  formatTerm,
  formatLtv,
  type PublicLoanProduct,
} from "@/lib/loan";

export const dynamic = "force-dynamic";

export default async function LoanDetailPage({ params }: { params: { id: string } }) {
  const supabase = createPublicClient();
  const { data } = await supabase
    .from("public_loan_products")
    .select("*")
    .eq("id", params.id)
    .maybeSingle();
  if (!data) notFound();
  const p = data as PublicLoanProduct;
  const buyer = await getBuyer();

  const specs = [
    { label: "年化利率", value: formatRate(p.rate_min, p.rate_max) },
    { label: "最高额度", value: formatLoanAmount(p.amount_max) },
    { label: "最长年限", value: formatTerm(p.term_max_years) },
    { label: "最高成数", value: formatLtv(p.ltv_max) },
  ].filter((s) => s.value);

  return (
    <div className="yfp-m">
      <main className="m-wrap">
        <header className="m-bar">
          <Link href="/m/loan" className="back">
            ←
          </Link>
          <b>产品详情</b>
          <Link href={buyer ? "/m/account" : "/m/login"} className="m-bar-link">
            {buyer ? "我的" : "登录"}
          </Link>
        </header>

        <div className="m-loan-detail">
          <span className="m-loan-type">{LOAN_TYPE_LABEL[p.loan_type]}</span>
          <h1>{p.name}</h1>
          <p className="m-loan-bank">{p.bank_name}</p>
          {p.highlight ? <p className="m-loan-hl big">{p.highlight}</p> : null}

          <div className="m-loan-specs">
            {specs.map((s) => (
              <div key={s.label} className="m-loan-spec">
                <em>{s.label}</em>
                <b>{s.value}</b>
              </div>
            ))}
          </div>

          {p.requirements.length ? (
            <section className="m-loan-req">
              <h3>申请条件</h3>
              <ul>
                {p.requirements.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </section>
          ) : null}

          <p className="m-loan-disclaimer">
            以上信息仅供撮合参考，最终利率、额度与审批以银行/机构为准。平台仅提供信息对接，不放贷、不担保、不触碰资金。
          </p>
        </div>
      </main>

      <div className="m-loan-bottombar">
        <Link href={`/m/loan/apply?product=${p.id}`} className="m-loan-apply-btn">
          预约顾问 · 免费测算
        </Link>
      </div>
    </div>
  );
}
