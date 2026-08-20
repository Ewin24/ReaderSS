/**
 * Streamed, byte-counted body reading for the feed relay (limits: 5 MiB
 * max body, `Content-Length` is a hint, never trusted).
 * An unbounded relay body read is a memory and cost hazard for the Worker;
 * this reads chunk by chunk and aborts as soon as the streamed byte count
 * exceeds the limit, regardless of what any `Content-Length` header claims.
 */

export const MAX_BODY_BYTES = 5 * 1024 * 1024; // 5 MiB

export class PayloadTooLargeError extends Error {
  constructor(limitBytes: number) {
    super(`response body exceeded the ${limitBytes}-byte limit`);
    this.name = "PayloadTooLargeError";
  }
}

/**
 * Reads `response`'s body up to `limitBytes`, counting streamed bytes as
 * they arrive. Throws PayloadTooLargeError as soon as the cap is crossed,
 * without buffering the remainder of the stream.
 */
export async function readLimitedBody(
  response: Response,
  limitBytes: number = MAX_BODY_BYTES,
): Promise<ArrayBuffer> {
  if (response.body === null) {
    return new ArrayBuffer(0);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    total += value.byteLength;
    if (total > limitBytes) {
      await reader.cancel();
      throw new PayloadTooLargeError(limitBytes);
    }
    chunks.push(value);
  }

  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result.buffer;
}
