import { z } from "zod";
export const intentRequestSchema = z
  .object({
    amount: z.number().int().positive().max(100_000_000),
    currency: z.literal("BDT"),
    reference: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .regex(/^[^\x00-\x1f\x7f]+$/),
    provider: z.enum(["bkash", "nagad", "rocket", "upay"]),
    provider_account_id: z.uuid(),
    customer_reference: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .regex(/^[^\x00-\x1f\x7f]+$/)
      .optional(),
    expires_at: z.iso
      .datetime({ offset: true })
      .transform((v) => new Date(v).toISOString())
      .optional(),
    metadata: z
      .record(z.string().max(64), z.unknown())
      .default({})
      .refine(
        (v) =>
          Object.keys(v).length <= 20 &&
          new TextEncoder().encode(JSON.stringify(v)).length <= 4096,
      ),
  })
  .strict();
export const idempotencySchema = z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/);
export const publicIdSchema = z.string().regex(/^pi_[a-f0-9]{32}$/);
const transactionReferenceSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .transform((value) => value.toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9][A-Z0-9._-]{0,127}$/));
export const verifyTransactionSchema = z
  .object({
    transaction_id: transactionReferenceSchema,
    amount: z.number().int().positive().max(100_000_000),
    provider: z.enum(["bkash", "nagad", "rocket", "upay"]).optional(),
  })
  .strict();
export const verificationIdSchema = z
  .string()
  .regex(/^vr_[a-f0-9]{32}$/);
export const confirmTransactionSchema = z
  .object({ verification_id: verificationIdSchema })
  .strict();
export type ApiCode =
  | "invalid_api_key"
  | "insufficient_scope"
  | "invalid_request"
  | "resource_not_found"
  | "idempotency_conflict"
  | "provider_account_invalid"
  | "transaction_not_verifiable"
  | "verification_not_found"
  | "verification_expired"
  | "verification_unavailable"
  | "provider_not_supported"
  | "internal_error"
  | "development_api_disabled";
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: ApiCode,
  ) {
    super(code);
  }
}
const messages: Record<ApiCode, string> = {
  invalid_api_key: "API credential is invalid.",
  insufficient_scope: "Required ability is missing.",
  invalid_request: "Request is invalid.",
  resource_not_found: "Resource was not found.",
  idempotency_conflict:
    "Idempotency key or reference conflicts with an existing request.",
  provider_account_invalid: "Provider account is unavailable for this request.",
  transaction_not_verifiable: "Transaction could not be verified.",
  verification_not_found: "Verification was not found.",
  verification_expired: "Verification has expired.",
  verification_unavailable: "Verification cannot be consumed.",
  provider_not_supported: "Provider is not available for automatic verification.",
  internal_error: "Service is temporarily unavailable.",
  development_api_disabled: "Development API is disabled.",
};
export function apiFailure(error: unknown) {
  const e =
    error instanceof ApiError ? error : new ApiError(503, "internal_error");
  return Response.json(
    { error: { code: e.code, message: messages[e.code] } },
    {
      status: e.status,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        ...(e.status === 401 ? { "WWW-Authenticate": "Bearer" } : {}),
      },
    },
  );
}
export function apiSuccess(data: unknown, status = 200) {
  return Response.json(
    { data },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
export function transactionApiFailure(error: unknown) {
  const response = apiFailure(error);
  return response.json().then((body) =>
    Response.json(
      { success: false, ...body },
      { status: response.status, headers: response.headers },
    ),
  );
}
export function transactionApiSuccess(data: unknown) {
  return Response.json(
    { success: true, data },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}
export function rpcFailure(code: string | undefined): never {
  if (code === "EK401") throw new ApiError(401, "invalid_api_key");
  if (code === "EK403") throw new ApiError(403, "insufficient_scope");
  if (code === "EK409" || code === "23505")
    throw new ApiError(409, "idempotency_conflict");
  if (code === "EK422") throw new ApiError(422, "provider_account_invalid");
  if (code === "22023") throw new ApiError(400, "invalid_request");
  throw new ApiError(503, "internal_error");
}
export function transactionRpcFailure(code: string | undefined): never {
  if (code === "EK401") throw new ApiError(401, "invalid_api_key");
  if (code === "EK403") throw new ApiError(403, "insufficient_scope");
  if (code === "EK409") throw new ApiError(409, "idempotency_conflict");
  if (code === "EKV01" || code === "23505")
    throw new ApiError(422, "transaction_not_verifiable");
  if (code === "EKV02") throw new ApiError(409, "verification_expired");
  if (code === "EKV03") throw new ApiError(404, "verification_not_found");
  if (code === "EKV04") throw new ApiError(422, "provider_not_supported");
  if (code === "EKV05") throw new ApiError(409, "verification_unavailable");
  if (code === "22023") throw new ApiError(400, "invalid_request");
  throw new ApiError(503, "internal_error");
}
