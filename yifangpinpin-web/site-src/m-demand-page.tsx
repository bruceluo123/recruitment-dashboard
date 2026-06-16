import Link from "next/link";
import { submitDemand } from "./actions";

export const metadata = { title: "登记购房需求 · 易房拼拼" };

export default function DemandPage({
  searchParams,
}: {
  searchParams: { from?: string; intent?: string; error?: string };
}) {
  const title = searchParams.intent === "want" ? "登记购房意向" : "预约顾问咨询";
  return (
    <div className="yfp-m">
      <main className="m-wrap">
        <header className="m-bar">
          <Link href={searchParams.from ? `/m/p/${searchParams.from}` : "/m"} className="back">
            ←
          </Link>
          <b>{title}</b>
        </header>

        <div className="m-form">
          <p className="lead">留下您的联系方式与需求，专属顾问将尽快与您联系。</p>
          {searchParams.error ? <p className="err">{searchParams.error}</p> : null}

          <form action={submitDemand}>
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
              <label>微信号</label>
              <input name="wechat" placeholder="方便顾问添加（选填）" className="m-input" />
            </div>
            <div className="m-field row">
              <div>
                <label>预算下限 (万)</label>
                <input name="budget_min" type="number" step="1" className="m-input" />
              </div>
              <div>
                <label>预算上限 (万)</label>
                <input name="budget_max" type="number" step="1" className="m-input" />
              </div>
            </div>
            <div className="m-field">
              <label>意向区域</label>
              <input name="districts" placeholder="多个区域用逗号分隔，如 南山，福田" className="m-input" />
            </div>
            <div className="m-field">
              <label>购房目的</label>
              <select name="purpose" className="m-input" defaultValue="self_use">
                <option value="self_use">自住</option>
                <option value="invest">投资</option>
                <option value="finance">资金周转</option>
              </select>
            </div>
            <div className="m-field">
              <label>补充说明</label>
              <textarea name="note" rows={3} placeholder="其他需求（选填）" className="m-input" />
            </div>
            <button type="submit" className="m-submit">
              提交需求
            </button>
            <p className="m-fineprint">提交即表示同意平台仅用于撮合联系，不涉及任何资金往来。</p>
          </form>
        </div>
      </main>
    </div>
  );
}
