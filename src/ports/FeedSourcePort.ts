/**
 * Port over fetching one feed's raw body through the Worker relay
 * (design.md §2 "The Relay Contract"). The only production implementation
 * is `adapters/feed/relayFeedSource.ts`. This port hands back the raw
 * body text and conditional-GET validators only — parsing the body into
 * domain `Entry` objects is Slice 5's `feedParser`, not this port's job.
 */

import { RELAY_ERROR_CODES } from "../../shared/feedErrorCodes";

/** The relay-emitted codes (`RELAY_ERROR_CODES`, `shared/feedErrorCodes.ts` —
 * the single source of truth also imported by `worker/routes/feed.ts`, so
 * the two runtimes cannot drift out of sync), plus two client-only codes for
 * cases the relay itself cannot report because the relay never ran:
 * `NETWORK_ERROR` when the relay endpoint was unreachable (feed-fetching
 * spec, "Relay unreachable during refresh"), and `CLIENT_TIMEOUT` when the
 * relay was reachable but did not respond within this adapter's own bounded
 * wait (`relayFeedSource.ts`'s `CLIENT_TIMEOUT_MS`). */
export const FEED_FETCH_ERROR_CODES = [...RELAY_ERROR_CODES, "NETWORK_ERROR", "CLIENT_TIMEOUT"] as const;

export type FeedFetchErrorCode = (typeof FEED_FETCH_ERROR_CODES)[number];

export interface FeedFetchValidators {
  readonly etag: string | null;
  readonly lastModified: string | null;
}

export type FeedFetchResult =
  | {
      readonly status: "updated";
      readonly body: string;
      readonly contentType: string;
      readonly etag: string | null;
      readonly lastModified: string | null;
    }
  | { readonly status: "not-modified" }
  | { readonly status: "error"; readonly code: FeedFetchErrorCode; readonly message: string };

export interface FeedSourcePort {
  fetchFeed(url: string, validators: FeedFetchValidators): Promise<FeedFetchResult>;
}
