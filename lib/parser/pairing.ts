import "server-only";
import { z } from "zod";
import { sha256 } from "@/lib/ingestion/protocol";
import { decodeParserPublicKey, ed25519Verify } from "./protocol";
export const pairSchema = z.strictObject({ device_id: z.uuid().transform(v => v.toLowerCase()),
  expected_version: z.number().int().min(0).max(2147483646), pairing_token: z.string().regex(/^[a-f0-9]{64}$/),
  public_key: z.string().length(43), proof_signature: z.string().regex(/^[a-f0-9]{128}$/) });
export function pairingCanonical(deviceId: string, expectedVersion: number, tokenHash: string, key: Uint8Array) {
  return Buffer.from(["ekpay-parser-pair-v1", deviceId, String(expectedVersion), tokenHash, sha256(key)].join("\n"), "utf8");
}
export async function pairSyntheticParser(input: unknown, consume: (device: string, hash: string, key: Uint8Array, version: number) => Promise<unknown>) {
  if (process.env.NODE_ENV !== "test" || process.env.EKPAY_PARSER_INGESTION_ENABLED !== "true") throw new Error("parser_disabled");
  const parsed = pairSchema.safeParse(input);
  if (!parsed.success) throw new Error("invalid_pairing");
  const p = parsed.data, key = decodeParserPublicKey(p.public_key), hash = sha256(p.pairing_token);
  if (!ed25519Verify(key, pairingCanonical(p.device_id, p.expected_version, hash, key), p.proof_signature)) throw new Error("invalid_pairing");
  return consume(p.device_id, hash, key, p.expected_version);
}
