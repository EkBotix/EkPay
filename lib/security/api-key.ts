import "server-only";
import {
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
export function hashApiKey(secret: string, pepper: string) {
  if (pepper.length < 32)
    throw new Error("API key hashing configuration unavailable");
  return createHmac("sha256", pepper).update(secret).digest("hex");
}
export function apiKeyHashMatches(
  secret: string,
  stored: string,
  pepper: string,
) {
  const hash = hashApiKey(secret, pepper);
  const valid = /^[a-f0-9]{64}$/.test(stored);
  return (
    timingSafeEqual(
      Buffer.from(hash, "hex"),
      Buffer.from(valid ? stored : "0".repeat(64), "hex"),
    ) && valid
  );
}
export function generateApiKey(environment: "test" | "live", pepper: string) {
  if (pepper.length < 32)
    throw new Error("API key hashing configuration unavailable");
  const prefix = `ek_${environment}_${randomBytes(8).toString("hex")}`;
  const secret = `${prefix}_${randomBytes(32).toString("base64url")}`;
  return {
    id: randomUUID(),
    prefix,
    secret,
    hash: hashApiKey(secret, pepper),
  };
}
