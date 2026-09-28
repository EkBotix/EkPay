import "server-only";
import { authenticateApi } from "./auth";
import { readJson } from "./body";
import {
  ApiError,
  confirmTransactionSchema,
  idempotencySchema,
  transactionApiFailure,
  transactionApiSuccess,
  transactionRpcFailure,
  verifyTransactionSchema,
} from "./contract";

export async function verifyTransaction(request: Request) {
  try {
    const { context, client } = await authenticateApi(request, "trx:verify");
    const idempotency = idempotencySchema.safeParse(
      request.headers.get("idempotency-key"),
    );
    const payload = verifyTransactionSchema.safeParse(await readJson(request, 1024));
    if (!idempotency.success || !payload.success)
      throw new ApiError(400, "invalid_request");
    const { data, error } = await client.rpc("api_verify_transaction", {
      p_key_id: context.keyId,
      p_idempotency_key: idempotency.data,
      p_payload: payload.data,
    });
    if (error) transactionRpcFailure(error.code);
    if (!data?.verification) throw new ApiError(503, "internal_error");
    return transactionApiSuccess(data.verification);
  } catch (error) {
    return transactionApiFailure(error);
  }
}

export async function confirmTransaction(request: Request) {
  try {
    const { context, client } = await authenticateApi(request, "trx:confirm");
    const idempotency = idempotencySchema.safeParse(
      request.headers.get("idempotency-key"),
    );
    const payload = confirmTransactionSchema.safeParse(await readJson(request, 1024));
    if (!idempotency.success || !payload.success)
      throw new ApiError(400, "invalid_request");
    const { data, error } = await client.rpc("api_confirm_transaction", {
      p_key_id: context.keyId,
      p_idempotency_key: idempotency.data,
      p_verification_id: payload.data.verification_id,
    });
    if (error) transactionRpcFailure(error.code);
    if (!data?.verification) throw new ApiError(503, "internal_error");
    return transactionApiSuccess(data.verification);
  } catch (error) {
    return transactionApiFailure(error);
  }
}
