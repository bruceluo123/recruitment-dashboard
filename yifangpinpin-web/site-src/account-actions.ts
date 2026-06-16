"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { buyerEmail, maskPhone, PHONE_RE } from "@/lib/buyer";

function fail(path: string, msg: string, redirectTo?: string): never {
  const params = new URLSearchParams({ error: msg });
  if (redirectTo) params.set("redirect", redirectTo);
  redirect(`${path}?${params.toString()}`);
}

export async function registerBuyer(formData: FormData) {
  const phone = String(formData.get("phone") || "").trim();
  const password = String(formData.get("password") || "");
  const confirm = String(formData.get("confirm") || "");
  const redirectTo = String(formData.get("redirect") || "/m/account").trim() || "/m/account";

  if (!PHONE_RE.test(phone)) fail("/m/register", "请填写正确的手机号", redirectTo);
  if (password.length < 6) fail("/m/register", "密码至少 6 位", redirectTo);
  if (password !== confirm) fail("/m/register", "两次输入的密码不一致", redirectTo);

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.createUser({
    email: buyerEmail(phone),
    password,
    email_confirm: true,
    app_metadata: { role: "buyer", phone },
    user_metadata: { nickname: maskPhone(phone) },
  });
  if (error) {
    const exists = /registered|exists|duplicate/i.test(error.message);
    fail("/m/register", exists ? "该手机号已注册，请直接登录" : "注册失败，请稍后重试", redirectTo);
  }

  // 注册成功后建立会话
  const supabase = createClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: buyerEmail(phone),
    password,
  });
  if (signInError) redirect("/m/login");
  redirect(redirectTo);
}

export async function loginBuyer(formData: FormData) {
  const phone = String(formData.get("phone") || "").trim();
  const password = String(formData.get("password") || "");
  const redirectTo = String(formData.get("redirect") || "/m/account").trim() || "/m/account";

  if (!PHONE_RE.test(phone)) fail("/m/login", "请填写正确的手机号", redirectTo);
  if (!password) fail("/m/login", "请填写密码", redirectTo);

  const supabase = createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: buyerEmail(phone),
    password,
  });
  if (error) fail("/m/login", "手机号或密码错误", redirectTo);
  redirect(redirectTo);
}

export async function logoutBuyer() {
  const supabase = createClient();
  await supabase.auth.signOut();
  redirect("/m");
}

export async function updateNickname(formData: FormData) {
  const nickname = String(formData.get("nickname") || "").trim();
  if (!nickname) fail("/m/account/profile", "昵称不能为空");
  const supabase = createClient();
  await supabase.auth.updateUser({ data: { nickname } });
  revalidatePath("/m/account");
  redirect("/m/account/profile?ok=1");
}

// 收藏/取消收藏。供客户端组件直接调用，返回最新收藏状态。
export async function toggleFavorite(
  propertyId: string,
): Promise<{ favorited: boolean; needLogin?: boolean }> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.app_metadata?.role !== "buyer") return { favorited: false, needLogin: true };

  const { data: existing } = await supabase
    .from("favorites")
    .select("id")
    .eq("user_id", user.id)
    .eq("property_id", propertyId)
    .maybeSingle();

  if (existing) {
    await supabase.from("favorites").delete().eq("id", existing.id);
    revalidatePath("/m/account/favorites");
    return { favorited: false };
  }

  await supabase.from("favorites").insert({ user_id: user.id, property_id: propertyId });
  revalidatePath("/m/account/favorites");
  return { favorited: true };
}
