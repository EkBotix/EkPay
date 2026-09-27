"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireUser, requireMerchantAccess } from "@/lib/merchant-context";
import { createServerSupabase } from "@/lib/supabase/server";
import { merchantSchema, uuidSchema } from "@/lib/validation";
import type { FormResult } from "./auth";
export async function bootstrapMerchant(
  _previous: FormResult,
  form: FormData,
): Promise<FormResult> {
  await requireUser();
  const parsed = merchantSchema.safeParse({
    name: form.get("name"),
    slug: form.get("slug"),
  });
  if (!parsed.success)
    return {
      message:
        "Use a 2–80 character name and a 3–48 character lowercase slug with letters, numbers or hyphens.",
    };
  let id: string;
  try {
    const client = await createServerSupabase(true);
    const { data, error } = await client.rpc("bootstrap_merchant", {
      p_name: parsed.data.name,
      p_slug: parsed.data.slug,
    });
    if (error || !uuidSchema.safeParse(data).success)
      return {
        message:
          "Unable to create this merchant. The slug may be unavailable, or onboarding is not enabled yet.",
      };
    id = data;
  } catch {
    return { message: "Merchant onboarding is unavailable. Try again later." };
  }
  (await cookies()).set("ekpay_merchant", id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  redirect("/dashboard");
}
export async function switchMerchant(form: FormData) {
  const parsed = uuidSchema.safeParse(form.get("merchantId"));
  if (!parsed.success) redirect("/dashboard?notice=invalid-merchant");
  await requireMerchantAccess(parsed.data);
  (await cookies()).set("ekpay_merchant", parsed.data, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  redirect("/dashboard");
}
