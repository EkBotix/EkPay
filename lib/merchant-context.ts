import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createServerSupabase } from "@/lib/supabase/server";
import { hasPublicSupabaseConfig } from "@/lib/supabase/config";
import {
  uuidSchema,
  roleSchema,
  isConfirmedUser,
  type MerchantRole,
} from "@/lib/validation";
export class AccessError extends Error {
  constructor() {
    super("Access unavailable");
  }
}
export const requireUser = cache(async () => {
  if (!hasPublicSupabaseConfig()) redirect("/login?notice=setup");
  const client = await createServerSupabase();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user || !isConfirmedUser(data.user)) redirect("/login");
  return { user: data.user, client };
});
export type Membership = {
  merchantId: string;
  name: string;
  slug: string;
  role: MerchantRole;
  status: string;
};
export const getUserMerchants = cache(async (): Promise<Membership[]> => {
  const { user, client } = await requireUser();
  const { data, error } = await client
    .from("merchant_members")
    .select("merchant_id,role")
    .eq("user_id", user.id)
    .order("created_at");
  if (error) throw new AccessError();
  if (!data?.length) return [];
  const { data: merchants, error: merchantError } = await client
    .from("merchants")
    .select("id,name,slug,status")
    .in(
      "id",
      data.map((m) => m.merchant_id),
    );
  if (merchantError || !merchants) throw new AccessError();
  return data.flatMap((row) => {
    const merchant = merchants.find((m) => m.id === row.merchant_id);
    const role = roleSchema.safeParse(row.role);
    return merchant && role.success
      ? [
          {
            merchantId: merchant.id,
            name: merchant.name,
            slug: merchant.slug,
            status: merchant.status,
            role: role.data,
          },
        ]
      : [];
  });
});
export async function requireMerchantAccess(merchantId?: string) {
  const memberships = await getUserMerchants();
  if (!memberships.length) redirect("/onboarding");
  const preference = (await cookies()).get("ekpay_merchant")?.value;
  const selected =
    merchantId ??
    memberships.find(
      (m) => m.merchantId === preference && m.status === "active",
    )?.merchantId ??
    memberships.find((m) => m.status === "active")?.merchantId;
  if (!uuidSchema.safeParse(selected).success) throw new AccessError();
  const merchant = memberships.find((m) => m.merchantId === selected);
  if (!merchant || merchant.status !== "active") throw new AccessError();
  return merchant;
}
export async function requireMerchantRole(
  merchantId: string | undefined,
  roles: readonly MerchantRole[],
) {
  const merchant = await requireMerchantAccess(merchantId);
  if (!roles.includes(merchant.role)) throw new AccessError();
  return merchant;
}
