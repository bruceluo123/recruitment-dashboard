import { signIn } from "./actions";

export const metadata = { title: "登录 · 易房拼拼" };

export default function LoginPage({
  searchParams,
}: {
  searchParams: { error?: string; redirect?: string };
}) {
  return (
    <main className="yfp-login">
      <div className="yfp-login-bg" aria-hidden />
      <div className="yfp-login-card">
        <div className="yfp-login-hd">
          <span className="yfp-login-logo">易房拼拼</span>
          <p>笋盘交易撮合 · 经纪后台</p>
        </div>

        {searchParams.error ? (
          <p className="yfp-login-err">{searchParams.error}</p>
        ) : null}

        <form action={signIn} className="yfp-login-form">
          <input type="hidden" name="redirect" value={searchParams.redirect || "/admin"} />
          <div className="yfp-login-field">
            <label htmlFor="email">邮箱</label>
            <input id="email" name="email" type="email" autoComplete="email" required placeholder="name@example.com" />
          </div>
          <div className="yfp-login-field">
            <label htmlFor="password">密码</label>
            <input id="password" name="password" type="password" autoComplete="current-password" required placeholder="请输入密码" />
          </div>
          <button type="submit" className="yfp-login-btn">
            登录后台
          </button>
        </form>

        <p className="yfp-login-foot">仅限经纪 / 管理员使用</p>
      </div>
    </main>
  );
}
