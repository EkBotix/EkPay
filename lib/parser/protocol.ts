import "server-only";
import { createPublicKey, verify } from "node:crypto";
import { z } from "zod";
import { sha256 } from "@/lib/ingestion/protocol";
export const PARSER_BODY_LIMIT = 4096;
export const PARSER_CLOCK_WINDOW_MS = 300_000;
export const paths = { evidence: "/api/internal/parser/evidence", heartbeat: "/api/internal/parser/heartbeat" } as const;
export const parserHeaderSchema = z.strictObject({
  protocol: z.literal("1"), device_id: z.uuid().transform(v => v.toLowerCase()),
  key_version: z.string().regex(/^[1-9][0-9]{0,9}$/).transform(Number).pipe(z.number().int().max(2147483647)),
  timestamp: z.string().regex(/^[1-9][0-9]{12}$/).transform(Number),
  nonce: z.string().regex(/^[A-Za-z0-9_-]{22}$/).refine(v => Buffer.from(v, "base64url").length === 16 && Buffer.from(v, "base64url").toString("base64url") === v),
  ingestion_id: z.uuidv4().transform(v => v.toLowerCase()),
  message_hash: z.string().regex(/^[a-f0-9]{64}$/), signature: z.string().regex(/^[a-f0-9]{128}$/),
});
export type ParserHeaders = z.output<typeof parserHeaderSchema>;
export function parseParserHeaders(headers: Headers) {
  return parserHeaderSchema.parse({protocol: headers.get("EkPay-Parser-Protocol"), device_id: headers.get("X-EkPay-Device-Id"),
    key_version: headers.get("X-EkPay-Key-Version"), timestamp: headers.get("X-EkPay-Timestamp"), nonce: headers.get("X-EkPay-Nonce"),
    ingestion_id: headers.get("X-EkPay-Ingestion-Id"), message_hash: headers.get("X-EkPay-Message-Hash"), signature: headers.get("X-EkPay-Signature")});
}
export function parserCanonical(h: ParserHeaders, path: typeof paths[keyof typeof paths], body: Uint8Array) {
  return Buffer.from(["ekpay-parser-v1", "POST", path, h.device_id, String(h.key_version), String(h.timestamp), h.nonce,
    h.ingestion_id, h.message_hash, sha256(body)].join("\n"), "utf8");
}
export function ed25519Verify(publicKey: Uint8Array, bytes: Uint8Array, signature: string) {
  if (publicKey.length !== 32 || !/^[a-f0-9]{128}$/.test(signature)) return false;
  try {
    const key = createPublicKey({key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), publicKey]), type: "spki", format: "der"});
    return verify(null, bytes, key, Buffer.from(signature, "hex"));
  } catch { return false; }
}
export function decodeParserPublicKey(value: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) throw new Error("invalid_pairing");
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length !== 32 || bytes.toString("base64url") !== value || bytes.every(v => v === 0) || bytes.every(v => v === 255)) throw new Error("invalid_pairing");
  return bytes;
}
