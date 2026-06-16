"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";

const PHONE_RE = /^1[3-9]\d{9}$/;
const LOAN_TYPES = ["mortgage_buy", "mortgage_biz", "mortgage_consume", "provident", "other"];

function num(v: FormDataEntryValue | null): number | null {
  if (v == null || String(v).trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function submitLoanApplication(formData: FormData) {
  const name = String(formData.get("name") || "").trim() || null;
  const phone = String(formData.get("phone") || "").trim();
  const productId = String(formData.get("product_id") || "").trim() || null;
  const rawType = String(formData.get("loan_type") || "").trim();
  const loanType = LOAN_TYPES.includes(rawType) ? rawType : null;
  const amountWanted = num(formData.get("amount_wanted"));
  const propertyValue = num(formData.get("property_value"));
  const hasProperty = String(formData.get("has_property") || "false") === "true";
  const note = String(formData.get("note") || "").trim() || null;
  const fromId = String(formData.get("from") || "").trim() || null;

  const errBack = (msg: string) => {
    const params = new URLSearchParams({ error: msg });
    if (productId) params.set("product", productId);
    if (fromId) params.set("from", fromId);
    redirect(`/m/loan/apply?${params.toString()}`);
  };

  if (!PHONE_RE.test(phone)) errBack("请填写正确的手机号");

  // service-role 客户端写入（绕过 RLS，C 端无登录会话）
  const admin = createAdminClient();

  // 手机号去重：已存在则复用客户
  const { data: existing } = await admin
    .from("customers")
    .select("id")
    .eq("phone", phone)
    .maybeSingle();

  let customerId = existing?.id as string | undefined;

  if (!customerId) {
    const { data: inserted, error } = await admin
      .from("customers")
      .insert({
        name,
        phone,
        customer_type: "buyer",
        source: "H5:loan",
      })
      .select("id")
      .single();
    if (error) errBack("提交失败，请稍后重试");
    customerId = inserted!.id as string;
  }

  const { error: appError } = await admin.from("loan_applications").insert({
    customer_id: customerId,
    product_id: productId,
    name,
    phone,
    loan_type: loanType,
    amount_wanted: amountWanted,
    property_value: propertyValue,
    has_property: hasProperty,
    note,
    status: "open",
    source: fromId ? `H5:${fromId}` : "H5:loan",
  });
  if (appError) errBack("提交失败，请稍后重试");

  redirect("/m/loan/apply/success");
}
