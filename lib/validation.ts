import { z } from "zod";
export const abilities = [
  "payment_intents:create",
  "payment_intents:read",
  "transactions:read",
  "webhooks:read",
  "webhooks:manage",
] as const;
export const uuidSchema = z.uuid();
export const roleSchema = z.enum(["owner", "admin", "developer", "viewer"]);
export type MerchantRole = z.infer<typeof roleSchema>;
export function isConfirmedUser(
  user:
    { is_anonymous?: boolean; email_confirmed_at?: string } | null | undefined,
) {
  return Boolean(user && !user.is_anonymous && user.email_confirmed_at);
}
export const credentialsSchema = z
  .object({ email: z.email().max(254), password: z.string().min(12).max(128) })
  .strict();
export const loginSchema = credentialsSchema.extend({
  password: z.string().min(1).max(128),
});
export function normalizeSlug(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "-");
}
export const merchantSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2)
      .max(80)
      .regex(/^[^\x00-\x1f\x7f]+$/),
    slug: z
      .string()
      .transform(normalizeSlug)
      .pipe(z.string().regex(/^[a-z0-9][a-z0-9-]{1,46}[a-z0-9]$/)),
  })
  .strict();
export const keySchema = z
  .object({
    merchantId: uuidSchema,
    name: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .regex(/^[^\x00-\x1f\x7f]+$/),
    environment: z.enum(["test", "live"]),
    abilities: z
      .array(z.enum(abilities))
      .min(1)
      .max(5)
      .refine((v) => new Set(v).size === v.length),
  })
  .strict();
export function canManageKeys(role: MerchantRole) {
  return role === "owner" || role === "admin";
}
export function canReadDeveloperSettings(role: MerchantRole) {
  return role !== "viewer";
}
export function safeNextPath(value: string | null) {
  return value?.startsWith("/dashboard") &&
    !value.includes("\\") &&
    !value.includes("\n") &&
    /^\/dashboard(?:\/[^?#]*)?$/.test(value)
    ? value
    : "/dashboard";
}
