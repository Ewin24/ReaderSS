/**
 * Wires `FeedSourcePort -> feedParser -> LocalStorePort`.
 * Sanitization deliberately stays out of this path entirely:
 * what gets persisted here is the feed's raw HTML, exactly
 * as `feedParser` normalized it. Nothing is written to the store unless
 * both the fetch AND the parse succeed ("Add a feed by URL" MUST NOT
 * persist a subscription whose first fetch or parse failed).
 *
 * The feed row and its entries are written in one atomic call
 * (`LocalStorePort.addFeedWithEntries`, the create-only variant) rather
 * than a `putFeed` + `putEntry` loop: a rejection partway through must never leave a feed persisted with
 * only some of its entries. A rejection from that call surfaces as the
 * typed `persist-failed` result below, not an escaping exception.
 *
 * The existence pre-check below (`getFeed`) and the write are NOT treated
 * as sufficient on their own to prevent a duplicate: they are two separate
 * steps, so two same-origin tabs submitting the same URL in the same moment could both pass the check
 * before either writes. The pre-check stays, purely as an optimization --
 * it avoids a network fetch for the overwhelmingly common single-tab case
 * -- but the actual duplicate decision is made atomically by
 * `addFeedWithEntries` itself, which is IndexedDB's own keyed `add()`
 * under the hood and therefore cannot lose this race.
 *
 * RETENTION IS STILL DELIBERATELY NOT ENFORCED HERE:
 * `domain/retention/prunePolicy.selectPrunableEntries` has no call site in
 * this service, on purpose. Retention is placed "after every
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
  // Found by real use: `fetchResult.code === "RELAY_UNAVAILABLE"` means the
  // fetch technically succeeded but did not reach the relay at all (e.g. a
  // dev server with no Worker wired in, answering with its own app shell).
  // Kept distinct from `unreachable` -- which means the relay ran and the
  // ORIGIN could not be reached -- because the fix is different: nothing
  // about the submitted feed URL is wrong here.
  | { readonly status: "relay-unavailable"; readonly message: string }
  // `fetchResult.code === "PAYLOAD_TOO_LARGE"`: the relay reached the origin
  // and the origin responded, but the body exceeded the relay's 5 MiB cap
  // (worker/lib/limitedBody.ts). Kept distinct from `unreachable` because
  // that status's own message ("Could not reach ...") would be false here --
  // the feed WAS reached, it was just too large to relay.
  | { readonly status: "too-large"; readonly message: string }
  // The fetch and parse both
  // succeeded, but the atomic local-store write (`putFeedWithEntries`)
  // rejected -- e.g. an IndexedDB quota error. Surfaced as a defined
  // outcome instead of letting the exception escape this function.
  | { readonly status: "persist-failed"; readonly message: string };

export async function subscribeToFeed(
  deps: SubscribeToFeedDeps,
  input: SubscribeToFeedInput,
): Promise<SubscribeToFeedResult> {
  // "Malformed URL": rejected client-side, before
  // any network request. `toSafeHref` (domain/url/safeUrl.ts) already
  // implements exactly this check -- parse as an absolute URL, allow only
  // http(s) -- for the href-sink use case; reused here rather than
  // duplicating the same parse-and-allowlist logic a second time.
  if (toSafeHref(input.url) === null) {
    return { status: "invalid-url" };
  }

  const normalizedUrl = normalizeFeedUrl(input.url);

  // "Duplicate subscriptions are prevented": the
  // normalized URL IS the subscription identity (`Feed.id`
  // is the normalized feed URL), so this is a direct primary-key lookup,
  // not a scan, and happens before the network request to avoid fetching a
  // feed that will be rejected anyway.
  const existing = await deps.localStore.getFeed(normalizedUrl);
  if (existing !== undefined) {
    return { status: "duplicate", existing };
  }

  const fetchResult = await deps.feedSource.fetchFeed(input.url, { etag: null, lastModified: null });

  if (fetchResult.status === "error") {
    if (fetchResult.code === "RELAY_UNAVAILABLE") {
      return { status: "relay-unavailable", message: fetchResult.message };
    }
    if (fetchResult.code === "PAYLOAD_TOO_LARGE") {
      return { status: "too-large", message: fetchResult.message };
    }
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
    // A concurrent writer -- most
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
