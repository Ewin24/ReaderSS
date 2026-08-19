/**
 * Normalizes a feed URL into the canonical form used as a `feeds` object
 * store `id` (design.md §3): lowercased scheme+host, default port stripped,
 * fragment stripped, and a single trailing slash on a non-root path
 * collapsed. Query strings and path case are preserved verbatim — URL paths
 * are case-sensitive per RFC 3986 and normalizing them would risk treating
 * two genuinely distinct feed URLs as the same subscription.
 *
 * This is also the sole duplicate-detection identity used by
 * `services/subscribeToFeed.ts` (feed-subscriptions spec, "Duplicate
 * subscriptions are prevented"), which explicitly requires a URL differing
 * only by trailing slash or scheme/host case to collide with an existing
 * subscription.
 *
 * Throws on a malformed URL — callers that need a client-safe validation
 * result (no exception) should check the URL some other way first (see
 * `domain/url/safeUrl.ts#toSafeHref`).
 */
export function normalizeFeedUrl(url: string): string {
  const parsed = new URL(url);
  const scheme = parsed.protocol.toLowerCase();
  const host = parsed.hostname.toLowerCase();

  const isDefaultPort =
    parsed.port === "" ||
    (scheme === "http:" && parsed.port === "80") ||
    (scheme === "https:" && parsed.port === "443");
  const port = isDefaultPort ? "" : `:${parsed.port}`;

  let path = parsed.pathname;
  if (path.length > 1 && path.endsWith("/")) {
    path = path.slice(0, -1);
  }

  return `${scheme}//${host}${port}${path}${parsed.search}`;
}
