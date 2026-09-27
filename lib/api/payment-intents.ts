import "server-only";
import { authenticateApi } from "./auth";
import { readJson } from "./body";
import {
  ApiError,
  apiFailure,
  apiSuccess,
  idempotencySchema,
  intentRequestSchema,
  publicIdSchema,
  rpcFailure,
} from "./contract";
export async function createIntent(request: Request) {
  try {
    const { context, client } = await authenticateApi(
      request,
      "payment_intents:create",
    );
    const idem = idempotencySchema.safeParse(
      request.headers.get("idempotency-key"),
    );
    const parsed = intentRequestSchema.safeParse(await readJson(request));
    if (!idem.success || !parsed.success)
      throw new ApiError(400, "invalid_request");
    const { data, error } = await client.rpc("api_create_payment_intent", {
      p_key_id: context.keyId,
      p_idempotency_key: idem.data,
      p_payload: parsed.data,
    });
    if (error) rpcFailure(error.code);
    if (!data) throw new ApiError(503, "internal_error");
    return apiSuccess(data.intent, data.reused ? 200 : 201);
  } catch (error) {
    return apiFailure(error);
  }
}
export async function readIntent(request: Request, id: string) {
  try {
    const { context, client } = await authenticateApi(
      request,
      "payment_intents:read",
    );
    if (!publicIdSchema.safeParse(id).success)
      throw new ApiError(404, "resource_not_found");
    const { data, error } = await client.rpc("api_read_payment_intent", {
      p_key_id: context.keyId,
      p_public_id: id,
    });
    if (error) rpcFailure(error.code);
    if (!data) throw new ApiError(404, "resource_not_found");
    return apiSuccess(data);
  } catch (error) {
    return apiFailure(error);
  }
}
