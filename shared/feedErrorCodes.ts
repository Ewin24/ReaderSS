/**
 * Single source of truth for the relay's error-code taxonomy. Lives outside
 * both `src/**` and `worker/**` because the
 * layer-zone ESLint rule (`import-x/no-restricted-paths` in eslint.config.js)
 * forbids either side from importing the other directly. `worker/routes/feed.ts`
 * (the producer) and `src/ports/FeedSourcePort.ts` (the consumer) both import
 * this array instead of independently declaring the same eight codes, so the
 * two runtimes cannot drift out of sync — a code added to only one side is a
 * TypeScript compile error, not a silent runtime downgrade to
 * `UPSTREAM_ERROR` in `relayFeedSource.ts`'s `isKnownErrorCode` check.
 *
 * This module has zero dependencies and performs no I/O, so it is safe for
 * both the `app` (jsdom) and `worker` (plain Node) test/build environments.
 */
export const RELAY_ERROR_CODES = [
  "INVALID_URL",
  "BLOCKED_TARGET",
  "FORBIDDEN_ORIGIN",
  "UNSUPPORTED_CONTENT_TYPE",
  "PAYLOAD_TOO_LARGE",
  "TOO_MANY_REDIRECTS",
  "UPSTREAM_ERROR",
  "UPSTREAM_TIMEOUT",
] as const;

export type RelayErrorCode = (typeof RELAY_ERROR_CODES)[number];
