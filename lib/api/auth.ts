import "server-only";
import { apiKeyHashMatches } from "@/lib/security/api-key";
import { createPrivilegedSupabase } from "@/lib/supabase/admin";
import { ApiError } from "./contract";
export type ApiContext = {
  keyId: string;
  merchantId: string;
  environment: "test" | "live";
  abilities: string[];
};
export type KeyCandidate = {
  id: string;
  merchant_id: string;
  prefix: string;
  secret_hash: string;
  hash_version: number;
  environment: string;
  abilities: string[];
  status: string;
  expires_at: string | null;
};
export function parseBearer(value: string | null) {
  const match = value?.match(
    /^Bearer (ek_(test|live)_[a-f0-9]{16})_([A-Za-z0-9_-]{43})$/,
  );
  if (!match) throw new ApiError(401, "invalid_api_key");
  return { secret: value!.slice(7), prefix: match[1], environment: match[2] };
}
export function verifyCandidate(
  parsed: ReturnType<typeof parseBearer>,
  key: KeyCandidate | null,
  merchantStatus: string | null,
  pepper: string,
  ability: string,
  now = Date.now(),
): ApiContext {
  const matches = apiKeyHashMatches(
    parsed.secret,
    key?.secret_hash ?? "0".repeat(64),
    pepper,
  );
  if (
    !matches ||
    !key ||
    key.prefix !== parsed.prefix ||
    key.hash_version !== 1 ||
    key.status !== "active" ||
    merchantStatus !== "active" ||
    key.environment !== parsed.environment ||
    (key.expires_at !== null &&
      (!Number.isFinite(Date.parse(key.expires_at)) ||
        Date.parse(key.expires_at) <= now))
  )
    throw new ApiError(401, "invalid_api_key");
  if (!key.abilities.includes(ability))
    throw new ApiError(403, "insufficient_scope");
  return {
    keyId: key.id,
    merchantId: key.merchant_id,
    environment: key.environment as "test" | "live",
    abilities: key.abilities,
  };
}
export async function authenticateApi(request: Request, ability: string) {
  if (process.env.EKPAY_DEVELOPMENT_API_ENABLED !== "true")
    throw new ApiError(503, "development_api_disabled");
  const parsed = parseBearer(request.headers.get("authorization"));
  const pepper = process.env.API_KEY_HASH_SECRET ?? "";
  if (pepper.length < 32) throw new ApiError(503, "internal_error");
  const client = createPrivilegedSupabase();
  const { data: key, error } = await client
    .from("api_keys")
    .select(
      "id,merchant_id,prefix,secret_hash,hash_version,environment,abilities,status,expires_at",
    )
    .eq("prefix", parsed.prefix)
    .maybeSingle();
  if (error) throw new ApiError(503, "internal_error");
  let status: string | null = null;
  if (key) {
    const result = await client
      .from("merchants")
      .select("status")
      .eq("id", key.merchant_id)
      .maybeSingle();
    if (result.error) throw new ApiError(503, "internal_error");
    status = result.data?.status ?? null;
  }
  return {
    context: verifyCandidate(parsed, key, status, pepper, ability),
    client,
  };
}
