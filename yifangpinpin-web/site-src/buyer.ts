import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

// C 端购房者账号工具：合成邮箱 + 会话读取 + 浏览历史记录。
// 手机号/角色存 app_metadata（用户不可改）；昵称/头像存 user_metadata。

export const BUYER_EMAIL_DOMAIN = "buyer.yifangpinpin.com";

export const PHONE_RE = /^1[3-9]\d{9}$/;

export function buyerEmail(phone: string): string {
  return `${phone}@${BUYER_EMAIL_DOMAIN}`;
}

export interface Buyer {
  id: string;
  phone: string;
  nickname: string;
  avatarUrl: string | null;
}

function toBuyer(user: User): Buyer | null {
  if (user.app_metadata?.role !== "buyer") return null;
  const phone = String(user.app_metadata?.phone ?? "");
  const nickname = String(user.user_metadata?.nickname ?? "").trim() || maskPhone(phone);
  const avatarUrl = (user.user_metadata?.avatar_url as string | undefined) ?? null;
  return { id: user.id, phone, nickname, avatarUrl };
}

export function maskPhone(phone: string): string {
  return phone.length === 11 ? `${phone.slice(0, 3)}****${phone.slice(7)}` : phone;
}

// 读取当前登录购房者（非购房者或未登录返回 null）。
export async function getBuyer(): Promise<Buyer | null> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ? toBuyer(user) : null;
}

// 记录一次房源浏览（仅登录购房者；按 user+property 去重，刷新时间）。
export async function recordView(propertyId: string): Promise<void> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.app_metadata?.role !== "buyer") return;
  await supabase
    .from("browse_history")
    .upsert(
      { user_id: user.id, property_id: propertyId, viewed_at: new Date().toISOString() },
      { onConflict: "user_id,property_id" },
    );
}

// 当前购房者是否已收藏指定房源。
export async function isFavorited(propertyId: string): Promise<boolean> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase
    .from("favorites")
    .select("id")
    .eq("user_id", user.id)
    .eq("property_id", propertyId)
    .maybeSingle();
  return Boolean(data);
}
