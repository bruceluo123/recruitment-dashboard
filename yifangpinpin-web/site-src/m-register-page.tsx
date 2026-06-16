import Link from "next/link";
import { registerBuyer } from "../account/actions";

export const metadata = { title: "注册 · 易房拼拼" };

export default function RegisterPage({
  searchParams,
}: {
  searchParams: { redirect?: string; error?: string };
}) {
  const redirectTo = searchParams.redirect || "/m/account";
  const loginHref = `/m/login?redirect=${encodeURIComponent(redirectTo)}`;
  return (
    <div className="yfp-m">
      <main className="m-wrap">
        <header className="m-bar">
          <Link href="/m" className="back">
            ←
          </Link>
          <b>注册</b>
        </header>

        <div className="m-auth">
          <div className="m-auth-hd">
            <img src="/assets/logo.png" alt="易房拼拼" width={48} height={48} />
            <h1>创建账号</h1>
            <p>手机号注册，开启你的找房之旅</p>
          </div>

          {searchParams.error ? <p className="err">{searchParams.error}</p> : null}

          <form action={registerBuyer} className="m-form">
            <input type="hidden" name="redirect" value={redirectTo} />
            <div className="m-field">
              <label>手机号</label>
              <input name="phone" type="tel" required placeholder="11 位手机号" className="m-input" />
            </div>
            <div className="m-field">
              <label>设置密码</label>
              <input name="password" type="password" required placeholder="至少 6 位" className="m-input" />
            </div>
            <div className="m-field">
              <label>确认密码</label>
              <input name="confirm" type="password" required placeholder="再次输入密码" className="m-input" />
            </div>
            <button type="submit" className="m-submit">
              注册并登录
            </button>
            <p className="m-fineprint">注册即表示同意平台仅用于撮合联系，不涉及任何资金往来。</p>
          </form>

          <p className="m-auth-alt">
            已有账号？
            <Link href={loginHref}>去登录</Link>
          </p>
        </div>
      </main>
    </div>
  );
}
