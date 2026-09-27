import "server-only";
import { createHash, createPublicKey, verify } from "node:crypto";
import { z } from "zod";
export const requestSchema = z.strictObject({
  source_public_id: z.uuid().transform(v => v.toLowerCase()), key_version: z.number().int().positive().max(2147483647),
  timestamp_ms: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  nonce: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/), ingestion_id: z.uuid().transform(v => v.toLowerCase()),
  message_hash: z.string().regex(/^[a-f0-9]{64}$/), signature: z.string().regex(/^[a-f0-9]{128}$/),
});
export type SignedRequest = z.infer<typeof requestSchema>;
export const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
export function canonicalSignedMessage(request: SignedRequest, rawBody: Uint8Array) {
  const r = requestSchema.parse(request);
  return Buffer.from(["ekpay-source-synthetic-v1", String(r.timestamp_ms), r.nonce, r.source_public_id,
    String(r.key_version), r.ingestion_id, r.message_hash, sha256(rawBody), ""].join("\n"), "utf8");
}
export function signatureIsValid(request: SignedRequest, rawBody: Uint8Array, publicKey: Uint8Array) {
  if (publicKey.length !== 32 || rawBody.length > 4096) return false;
  try {
    const key = createPublicKey({key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), publicKey]), type: "spki", format: "der"});
    return verify(null, canonicalSignedMessage(request, rawBody), key, Buffer.from(request.signature, "hex"));
  } catch { return false; }
}
