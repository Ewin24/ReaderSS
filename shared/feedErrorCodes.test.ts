import { describe, expect, test } from "vitest";
import { RELAY_ERROR_CODES } from "./feedErrorCodes";

/**
 * `worker/routes/feed.ts`'s `ErrorCode` union and
 * `src/ports/FeedSourcePort.ts`'s `FEED_FETCH_ERROR_CODES` array
 * used to define the same eight codes independently in two runtimes, with
 * nothing enforcing the mirror. This module is now the single source of
 * truth both sides import, so a code added to only one side is a compile
 * error, not a silent runtime downgrade to `UPSTREAM_ERROR`. This test pins
 * the exact taxonomy so a future edit here is deliberate, not accidental.
 */
describe("RELAY_ERROR_CODES", () => {
  test("matches the error-code table exactly, in order", () => {
    expect(RELAY_ERROR_CODES).toEqual([
      "INVALID_URL",
      "BLOCKED_TARGET",
      "FORBIDDEN_ORIGIN",
      "UNSUPPORTED_CONTENT_TYPE",
      "PAYLOAD_TOO_LARGE",
      "TOO_MANY_REDIRECTS",
      "UPSTREAM_ERROR",
      "UPSTREAM_TIMEOUT",
    ]);
  });
});
