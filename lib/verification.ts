import "server-only";
import { cache } from "react";
// One clock value per SSR request, never a persistent/global cache.
export const requestTime = cache(async () => Date.now());
export function effectiveIntentState(
  status: string,
  expiresAt: string | null,
  now: number,
) {
  return ["created", "pending", "manual_review"].includes(status) &&
    expiresAt &&
    Date.parse(expiresAt) <= now
    ? "expired"
    : status;
}
