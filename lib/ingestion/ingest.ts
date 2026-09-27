import "server-only";
import { requestSchema, sha256, signatureIsValid, type SignedRequest } from "./protocol";
import { SyntheticEvidenceAdapter, type NormalizedFields, type SourceIdentity } from "./adapter";
export interface IngestionStore {
  source(publicId: string): Promise<SourceIdentity | null>;
  persist(request: SignedRequest, keyHash: string, bodyHash: string, fields: NormalizedFields): Promise<{ state: string; evidence_id: string; request_id: string; reused: boolean }>;
  verify(intentId: string, evidenceId: string): Promise<unknown>;
}
function gate() {
  if (process.env.NODE_ENV !== "test" || process.env.EKPAY_SYNTHETIC_INGESTION_ENABLED !== "true") throw new Error("synthetic_ingestion_disabled");
}
export async function authenticateEvidenceSource(store: IngestionStore, input: unknown, body: Uint8Array) {
  gate();
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) throw new Error("invalid_source");
  const request = parsed.data;
  const source = await store.source(request.source_public_id);
  if (!source || !SyntheticEvidenceAdapter.validateSource(source) || source.secret_key_version !== request.key_version ||
      Math.abs(Date.now() - request.timestamp_ms) > 300_000 || !signatureIsValid(request, body, source.signing_public_key)) throw new Error("invalid_source");
  return { request, source };
}
export async function ingestSyntheticEvidence(store: IngestionStore, input: unknown, rawBody: Uint8Array) {
  const { request, source } = await authenticateEvidenceSource(store, input, rawBody);
  let normalized: NormalizedFields;
  try { normalized = SyntheticEvidenceAdapter.normalize(rawBody); }
  catch { throw new Error("invalid_evidence"); }
  if (normalized.provider !== source.provider) throw new Error("source_provider_mismatch");
  // DB independently rechecks current key hash/version, source binding and freshness.
  return store.persist(request, sha256(source.signing_public_key), sha256(rawBody), normalized);
}
export async function handoffSyntheticVerification(store: IngestionStore, intentId: string, evidenceId: string) {
  gate();
  if (process.env.EKPAY_AUTO_VERIFY_SYNTHETIC_EVIDENCE !== "true") throw new Error("synthetic_handoff_disabled");
  // Separate committed transaction: failed evaluation cannot discard accepted evidence.
  return store.verify(intentId, evidenceId);
}
