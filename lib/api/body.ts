import "server-only";
import { ApiError } from "./contract";
export async function readJson(request: Request, limit = 8192) {
  if (
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
    "application/json"
  )
    throw new ApiError(415, "invalid_request");
  if (Number(request.headers.get("content-length")) > limit)
    throw new ApiError(413, "invalid_request");
  if (!request.body) throw new ApiError(400, "invalid_request");
  const reader = request.body.getReader();
  let length = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new ApiError(413, "invalid_request");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "invalid_request");
  } finally {
    reader.releaseLock();
  }
}
