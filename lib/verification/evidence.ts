import "server-only";
import { z } from "zod";

// Fixture normalization is never an ingestion or source-authentication boundary.
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const schema = z.strictObject({
  merchant_id: z.uuid(),
  environment: z.literal("test"),
  source: z.enum(["sms_parser", "provider_api", "manual"]),
  provider: z.enum(["bkash", "nagad", "rocket", "upay"]),
  provider_account_id: z.uuid(),
  provider_transaction_id: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9._-]{0,127}$/).nullable(),
  amount_minor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  currency: z.literal("BDT"),
  receiver_identity_hash: hash,
  sender_identity_hash: hash.nullable(),
  provider_timestamp: z.iso.datetime({ offset: true }).nullable(),
  ingestion_id: z.uuid(),
  message_hash: hash,
  metadata: z.strictObject({ fixture_label: z.string().max(120) }).optional(),
});

export function normalizeSyntheticEvidence(input: unknown) {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Synthetic evidence normalization is test-only");
  }
  const value = schema.parse(input);
  return {
    ...value,
    provider_timestamp: value.provider_timestamp ? new Date(value.provider_timestamp).toISOString() : null,
    trust_state: "synthetic" as const,
  };
}
