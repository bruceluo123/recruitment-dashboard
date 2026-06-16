import Link from "next/link";
import { createPublicClient } from "@/lib/supabase/public";
import { LOAN_TYPE_TABS, type PublicLoanProduct } from "@/lib/loan";
import { submitLoanApplication } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "免费贷款咨询 · 易房拼拼" };

export default async function LoanApplyPage({
  searchParams,
}: {
  searchParams: { product?: string; from?: string; error?: string };
}) {
  // 若带 product 参数，回显所选产品名，便于顾问对接
  let product: PublicLoanProduct | null = null;
  if (searchParams.product) {
    const supabase = createPublicClient();
    const { data } = await supabase
      .from("public_loan_products")
      .select("*")
      .eq("id", searchParams.product)
      .maybeSingle();
    product = (data as PublicLoanProduct) ?? null;
  }

  const backHref = searchParams.product ? `/m/loan/${searchParams.product}` : "/m/loan";

  return (
    <div className="yfp-m">
      <main className="m-wrap">
        <header className="m-bar">
          <Link href={backHref} className="back">
            ←
          </Link>
          <b>免费贷款咨询</b>
        </header>

        <div className="m-form">
          <p className="lead">留下联系方式与贷款需求，专属顾问免费帮你测算可贷额度与最优方案。</p>
          {product ? <p className="m-loan-picked">咨询产品：{product.name}（{product.bank_name}）</p> : null}
          {searchParams.error ? <p className="err">{searchParams.error}</p> : null}

          <form action={submitLoanApplication}>
            {searchParams.product ? (
              <input type="hidden" name="product_id" value={searchParams.product} />
            ) : null}
            {searchParams.from ? <input type="hidden" name="from" value={searchParams.from} /> : null}

            <div className="m-field">
              <label>称呼</label>
              <input name="name" placeholder="您怎么称呼" className="m-input" />
            </div>
            <div className="m-field">
              <label>
                手机号 <span className="req">*</span>
              </label>
              <input name="phone" type="tel" required placeholder="11 位手机号" className="m-input" />
            </div>
            <div className="m-field">
              <label>贷款类型</label>
              <select name="loan_type" className="m-input" defaultValue={product?.loan_type ?? ""}>
                <option value="">暂不确定，请顾问推荐</option>
                {LOAN_TYPE_TABS.filter((t) => t.value).map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="m-field row">
              <div>
                <label>期望额度 (万)</label>
                <input name="amount_wanted" type="number" step="1" className="m-input" />
              </div>
              <div>
                <label>房产估值 (万)</label>
                <input name="property_value" type="number" step="1" className="m-input" />
              </div>
            </div>
            <div className="m-field">
              <label>名下是否有房产</label>
              <select name="has_property" className="m-input" defaultValue="false">
                <option value="false">暂无 / 不确定</option>
                <option value="true">有可抵押房产</option>
              </select>
            </div>
            <div className="m-field">
              <label>补充说明</label>
              <textarea name="note" rows={3} placeholder="如征信情况、资金用途等（选填）" className="m-input" />
            </div>

            <button type="submit" className="m-submit">
              提交咨询
            </button>
            <p className="m-fineprint">
              提交即表示同意平台仅用于撮合联系，不涉及任何资金往来。利率额度以银行最终审批为准。
            </p>
          </form>
        </div>
      </main>
    </div>
  );
}
