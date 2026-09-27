import "server-only";
import { z } from "zod";
export const NORMALIZATION_VERSION = "ekpay-evidence-normalization-synthetic-v1";
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
const fields = z.strictObject({
  provider: z.enum(["bkash", "nagad", "rocket", "upay"]),
  // Synthetic namespace is uppercase. Real adapters must review provider semantics.
  provider_transaction_id: z.string().trim().regex(/^[A-Z0-9][A-Z0-9._-]{0,127}$/),
  amount_minor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  currency: z.string().transform(v => v.toUpperCase()).pipe(z.literal("BDT")),
  receiver_identity_hash: fingerprint, sender_identity_hash: fingerprint.nullable(),
  provider_timestamp: z.iso.datetime({ offset: true }),
});
export type NormalizedFields = z.infer<typeof fields>;
export type SourceIdentity = {
  id: string; public_id: string; merchant_id: string; environment: string;
  provider: string; provider_account_id: string; source_type: string; is_synthetic: boolean;
  status: string; secret_key_version: number; signing_public_key: Uint8Array;
};
export interface EvidenceAdapter {
  validateSource(source: SourceIdentity): boolean;
  normalize(rawBody: Uint8Array): NormalizedFields;
}
export const SyntheticEvidenceAdapter: EvidenceAdapter = {
  validateSource: s => s.status === "active" && s.is_synthetic && s.environment === "test" && s.source_type === "provider_api",
  normalize(rawBody) {
    if (rawBody.length > 4096) throw new Error("invalid_evidence");
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(rawBody);
    const value = fields.parse(JSON.parse(decoded));
    return { ...value, provider_timestamp: new Date(value.provider_timestamp).toISOString() };
  },
};
