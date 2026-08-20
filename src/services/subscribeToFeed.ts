/**
 * Wires `FeedSourcePort -> feedParser -> LocalStorePort` (design.md §8,
 * Slice 5). Sanitization deliberately stays out of this path entirely
 * (design.md §5): what gets persisted here is the feed's raw HTML, exactly
 * as `feedParser` normalized it. Nothing is written to the store unless
 * both the fetch AND the parse succeed (feed-subscriptions spec, "Add a
 * feed by URL": "MUST NOT persist a subscription whose first fetch or parse
 * failed").
 *
 * The feed row and its entries are written in one atomic call
 * (`LocalStorePort.addFeedWithEntries`, Finding 1 of the Slice 5 correction
 * round; changed to the create-only `addFeedWithEntries` variant in Finding
 * 2 of the Slice 10b correction round) rather than a `putFeed` + `putEntry`
 * loop: a rejection partway through must never leave a feed persisted with
 * only some of its entries. A rejection from that call surfaces as the
 * typed `persist-failed` result below, not an escaping exception.
 *
 * The existence pre-check below (`getFeed`) and the write are NOT treated
 * as sufficient on their own to prevent a duplicate (Finding 2, Slice 10b
 * correction round): they are two separate steps, so two same-origin tabs
 * submitting the same URL in the same moment could both pass the check
 * before either writes. The pre-check stays, purely as an optimization --
 * it avoids a network fetch for the overwhelmingly common single-tab case
 * -- but the actual duplicate decision is made atomically by
 * `addFeedWithEntries` itself, which is IndexedDB's own keyed `add()`
 * under the hood and therefore cannot lose this race.
 *
 * RETENTION IS STILL DELIBERATELY NOT ENFORCED HERE (Finding 2 of the
 * Slice 5 correction round; now confirmed unchanged by Slice 6):
 * `domain/retention/prunePolicy.selectPrunableEntries` has no call site in
 * this service, on purpose. design.md §3 places retention "after every
 * successful refresh", and that is now wired -- into `services/refreshFeeds.ts`,
 * not this one-time initial subscribe. A large feed's very first fetch (via
 * this function) is still unbounded; the per-feed cap and quota guard first
 * apply on that feed's next `refreshFeeds` pass. This remains a stated,
 * deliberate scope boundary, not an oversight.
 */
import { createFeed, type Feed } from "../domain/models/Feed";
import { normalizeFeedUrl } from "../domain/url/normalizeFeedUrl";
import { toSafeHref } from "../domain/url/safeUrl";
import type { ClockPort } from "../ports/ClockPort";
import type { FeedParserPort } from "../ports/FeedParserPort";
import type { FeedSourcePort } from "../ports/FeedSourcePort";
import type { LocalStorePort } from "../ports/LocalStorePort";

export interface SubscribeToFeedInput {
  readonly url: string;
  readonly folder?: string | null;
}

export interface SubscribeToFeedDeps {
  readonly feedSource: FeedSourcePort;
  readonly feedParser: FeedParserPort;
  readonly localStore: LocalStorePort;
  readonly clock: ClockPort;
}

export type SubscribeToFeedResult =
  | { readonly status: "subscribed"; readonly feed: Feed; readonly entryCount: number }
  | { readonly status: "duplicate"; readonly existing: Feed }
  | { readonly status: "invalid-url" }
  | { readonly status: "not-a-feed"; readonly message: string }
  | { readonly status: "unreachable"; readonly message: string }
  // Finding 1, Slice 5 correction round: the fetch and parse both
  // succeeded, but the atomic local-store write (`putFeedWithEntries`)
  // rejected -- e.g. an IndexedDB quota error. Surfaced as a defined
  // outcome instead of letting the exception escape this function.
  | { readonly status: "persist-failed"; readonly message: string };

export async function subscribeToFeed(
  deps: SubscribeToFeedDeps,
  input: SubscribeToFeedInput,
): Promise<SubscribeToFeedResult> {
  // feed-subscriptions spec, "Malformed URL": rejected client-side, before
  // any network request. `toSafeHref` (domain/url/safeUrl.ts) already
  // implements exactly this check -- parse as an absolute URL, allow only
  // http(s) -- for the href-sink use case; reused here rather than
  // duplicating the same parse-and-allowlist logic a second time.
  if (toSafeHref(input.url) === null) {
    return { status: "invalid-url" };
  }

  const normalizedUrl = normalizeFeedUrl(input.url);

  // feed-subscriptions spec, "Duplicate subscriptions are prevented": the
  // normalized URL IS the subscription identity (design.md §3: `Feed.id`
  // is the normalized feed URL), so this is a direct primary-key lookup,
  // not a scan, and happens before the network request to avoid fetching a
  // feed that will be rejected anyway.
  const existing = await deps.localStore.getFeed(normalizedUrl);
  if (existing !== undefined) {
    return { status: "duplicate", existing };
  }

  const fetchResult = await deps.feedSource.fetchFeed(input.url, { etag: null, lastModified: null });

  if (fetchResult.status === "error") {
    return { status: "unreachable", message: fetchResult.message };
  }
  if (fetchResult.status === "not-modified") {
    // A brand-new subscription sends no conditional-GET validators (both
    // null above), so the relay/origin has nothing to compare against and
    // cannot honestly answer 304. Treated as unreachable rather than
    // silently succeeding with no body to parse.
    return { status: "unreachable", message: "the feed unexpectedly returned no content to parse" };
  }

  const now = deps.clock.now();
  const parseResult = deps.feedParser.parse({ body: fetchResult.body, feedId: normalizedUrl, fetchedAt: now });

  if (parseResult.status === "error") {
    return { status: "not-a-feed", message: parseResult.message };
  }

  const feed: Feed = {
    ...createFeed({
      id: normalizedUrl,
      url: input.url,
      normalizedUrl,
      title: parseResult.feed.title,
      siteUrl: parseResult.feed.siteUrl,
      folder: input.folder ?? null,
      addedAt: now,
    }),
    etag: fetchResult.etag,
    lastModified: fetchResult.lastModified,
    lastFetchedAt: now,
    lastSuccessAt: now,
  };

  let writeResult: "created" | "duplicate";
  try {
    writeResult = await deps.localStore.addFeedWithEntries(feed, parseResult.feed.entries);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: "persist-failed", message };
  }

  if (writeResult === "duplicate") {
    // Finding 2, Slice 10b correction round: a concurrent writer -- most
    // realistically a second same-origin tab -- won the atomic create
    // between the existence pre-check above and this write. Re-read the
    // row that writer actually persisted so the caller gets an honest
    // `duplicate` result pointing at what is really in the store, instead
    // of a result built from data that was never written.
    const winner = await deps.localStore.getFeed(normalizedUrl);
    return { status: "duplicate", existing: winner ?? feed };
  }

  return { status: "subscribed", feed, entryCount: parseResult.feed.entries.length };
}
