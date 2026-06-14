import Link from "next/link";
import { redirect } from "next/navigation";
import { getBuyer, maskPhone } from "@/lib/buyer";
import { updateNickname, logoutBuyer } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "个人资料 · 易房拼拼" };

export default async function ProfilePage({ searchParams }: { searchParams: { ok?: string; error?: string } }) {
  const buyer = await getBuyer();
  if (!buyer) redirect("/m/login?redirect=/m/account/profile");

  return (
    <div className="yfp-m">
      <main className="m-wrap">
        <header className="m-bar">
          <Link href="/m/account" className="back">
            ←
          </Link>
          <b>个人资料</b>
        </header>

        <div className="m-form">
          {searchParams.ok ? <p className="m-ok">已保存</p> : null}
          {searchParams.error ? <p className="err">{searchParams.error}</p> : null}

          <form action={updateNickname}>
            <div className="m-field">
              <label>昵称</label>
              <input name="nickname" defaultValue={buyer.nickname} maxLength={20} className="m-input" />
            </div>
            <div className="m-field">
              <label>手机号</label>
              <input value={maskPhone(buyer.phone)} disabled className="m-input" />
            </div>
            <button type="submit" className="m-submit">
              保存
            </button>
          </form>

          <form action={logoutBuyer}>
            <button type="submit" className="m-logout">
              退出登录
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
