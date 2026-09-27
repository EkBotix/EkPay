"use server";
import { revalidatePath } from "next/cache";
import { requireMerchantRole, requireUser } from "@/lib/merchant-context";
import { createPrivilegedSupabase } from "@/lib/supabase/admin";
import { generateApiKey } from "@/lib/security/api-key";
import { keySchema, uuidSchema } from "@/lib/validation";
import type { FormResult } from "./auth";
export async function createApiKey(
  _previous: FormResult,
  form: FormData,
): Promise<FormResult> {
  const { user } = await requireUser();
  const parsed = keySchema.safeParse({
    merchantId: form.get("merchantId"),
    name: form.get("name"),
    environment: form.get("environment"),
    abilities: form.getAll("abilities"),
  });
  if (!parsed.success)
    return { message: "Choose a valid name, environment and known abilities." };
  try {
    await requireMerchantRole(parsed.data.merchantId, ["owner", "admin"]);
    const material = generateApiKey(
      parsed.data.environment,
      process.env.API_KEY_HASH_SECRET ?? "",
    );
    const { error } = await createPrivilegedSupabase().rpc(
      "create_merchant_api_key",
      {
        p_actor_id: user.id,
        p_merchant_id: parsed.data.merchantId,
        p_id: material.id,
        p_name: parsed.data.name,
        p_prefix: material.prefix,
        p_secret_hash: material.hash,
        p_environment: parsed.data.environment,
        p_abilities: parsed.data.abilities,
      },
    );
    if (error)
      return { message: "API key creation is unavailable or not permitted." };
    revalidatePath("/dashboard/developers");
    return {
      message: "Save this key now. It cannot be retrieved later.",
      secret: material.secret,
    };
  } catch {
    return { message: "API key creation is unavailable or not permitted." };
  }
}
export async function revokeApiKey(
  _previous: FormResult,
  form: FormData,
): Promise<FormResult> {
  const { user } = await requireUser();
  const merchantId = uuidSchema.safeParse(form.get("merchantId"));
  const keyId = uuidSchema.safeParse(form.get("keyId"));
  if (!merchantId.success || !keyId.success)
    return { message: "Invalid request." };
  try {
    await requireMerchantRole(merchantId.data, ["owner", "admin"]);
    const { error } = await createPrivilegedSupabase().rpc(
      "revoke_merchant_api_key",
      {
        p_actor_id: user.id,
        p_merchant_id: merchantId.data,
        p_key_id: keyId.data,
      },
    );
    if (error)
      return { message: "API key revocation is unavailable or not permitted." };
    revalidatePath("/dashboard/developers");
    return { message: "Key revoked." };
  } catch {
    return { message: "API key revocation is unavailable or not permitted." };
  }
}
