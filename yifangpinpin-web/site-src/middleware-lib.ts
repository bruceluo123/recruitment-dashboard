import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// 刷新 Supabase 会话；保护 /admin（仅后台用户）与 /m/account（仅购房者登录）。
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  // 缺少配置时直接放行，避免本地未配置环境变量时整站 500
  if (!url || !anon) return response;

  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isAdminRoute = pathname.startsWith("/admin");
  const isLoginRoute = pathname === "/login";
  const isAccountRoute = pathname.startsWith("/m/account");
  const isBuyer = user?.app_metadata?.role === "buyer";

  // C 端账号区：未登录跳转购房者登录页
  if (isAccountRoute && !user) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/m/login";
    redirectUrl.search = "";
    redirectUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(redirectUrl);
  }

  // 后台：未登录跳 /login；购房者越权访问 → 拦回 C 端（RLS 仍为最终兜底）
  if (isAdminRoute) {
    if (!user) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/login";
      redirectUrl.searchParams.set("redirect", pathname);
      return NextResponse.redirect(redirectUrl);
    }
    if (isBuyer) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/m";
      redirectUrl.search = "";
      return NextResponse.redirect(redirectUrl);
    }
  }

  // 后台登录页：已登录用户按角色分流
  if (isLoginRoute && user) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = isBuyer ? "/m/account" : "/admin";
    redirectUrl.search = "";
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}
