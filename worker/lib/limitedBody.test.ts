import { describe, expect, test } from "vitest";
import { readLimitedBody, PayloadTooLargeError } from "./limitedBody";

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

function responseWithStream(chunks: Uint8Array[], headers: HeadersInit = {}): Response {
  return new Response(streamOf(chunks), { headers });
}

describe("readLimitedBody", () => {
  test("reads a body under the limit and returns its exact bytes", async () => {
    const chunk = new TextEncoder().encode("hello world");
    const response = responseWithStream([chunk]);
    const result = await readLimitedBody(response, 1024);
    expect(new TextDecoder().decode(result)).toBe("hello world");
  });

  test("assembles multiple streamed chunks into one buffer, in order", async () => {
    const chunks = [
      new TextEncoder().encode("ab"),
      new TextEncoder().encode("cd"),
      new TextEncoder().encode("ef"),
    ];
    const response = responseWithStream(chunks);
    const result = await readLimitedBody(response, 1024);
    expect(new TextDecoder().decode(result)).toBe("abcdef");
  });

  test("throws PayloadTooLargeError once the streamed byte count exceeds the limit", async () => {
    const bigChunk = new Uint8Array(2000).fill(65);
    const response = responseWithStream([bigChunk]);
    await expect(readLimitedBody(response, 1000)).rejects.toBeInstanceOf(PayloadTooLargeError);
  });

  /**
   * The cap must be enforced against streamed bytes, never against the
   * Content-Length header. A response can lie about Content-Length (an
   * origin claiming a small body while actually streaming a large one);
   * this test's declared Content-Length is far below the limit while the
   * actual stream exceeds it, and the read must still be rejected.
   */
  test("a lying Content-Length far below the actual stream size does not bypass the cap", async () => {
    const bigChunk = new Uint8Array(2000).fill(66);
    const response = responseWithStream([bigChunk], { "Content-Length": "10" });
    await expect(readLimitedBody(response, 1000)).rejects.toBeInstanceOf(PayloadTooLargeError);
  });

  test("a body exactly at the limit is accepted", async () => {
    const chunk = new Uint8Array(1000).fill(67);
    const response = responseWithStream([chunk]);
    const result = await readLimitedBody(response, 1000);
    expect(result.byteLength).toBe(1000);
  });

  test("a null body returns an empty buffer", async () => {
    const response = new Response(null);
    const result = await readLimitedBody(response, 1000);
    expect(result.byteLength).toBe(0);
  });
});
