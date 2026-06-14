import Link from "next/link";
import { loginBuyer } from "../account/actions";

export const metadata = { title: "登录 · 易房拼拼" };

export default function LoginPage({
  searchParams,
}: {
  searchParams: { redirect?: string; error?: string };
}) {
  const redirectTo = searchParams.redirect || "/m/account";
  const registerHref = `/m/register?redirect=${encodeURIComponent(redirectTo)}`;
  return (
    <div className="yfp-m">
      <main className="m-wrap">
        <header className="m-bar">
          <Link href="/m" className="back">
            ←
          </Link>
          <b>登录</b>
        </header>

        <div className="m-auth">
          <div className="m-auth-hd">
            <img src="/assets/logo.png" alt="易房拼拼" width={48} height={48} />
            <h1>欢迎回来</h1>
            <p>登录后可收藏笋盘、查看需求进度</p>
          </div>

          {searchParams.error ? <p className="err">{searchParams.error}</p> : null}

          <form action={loginBuyer} className="m-form">
            <input type="hidden" name="redirect" value={redirectTo} />
            <div className="m-field">
              <label>手机号</label>
              <input name="phone" type="tel" required placeholder="11 位手机号" className="m-input" />
            </div>
            <div className="m-field">
              <label>密码</label>
              <input name="password" type="password" required placeholder="请输入密码" className="m-input" />
            </div>
            <button type="submit" className="m-submit">
              登录
            </button>
          </form>

          <p className="m-auth-alt">
            还没有账号？
            <Link href={registerHref}>立即注册</Link>
          </p>
        </div>
      </main>
    </div>
  );
}
