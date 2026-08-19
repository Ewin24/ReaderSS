/**
 * Refreshes every subscribed feed (design.md §2's conditional-refresh and
 * offline-failure sequence diagrams; §3's identity/dedup, unstable-GUID, and
 * retention rules; feed-fetching spec "Per-feed error isolation" and
 * "Refresh failure is visible, never silent").
 *
 * Write-path rule 3 (design.md §4): this is the file that matters most for
 * it. A refresh is never a user action, so it must never call
 * `toggleRead`/`toggleStar` and must never touch `read`/`readChangedAt`/
 * `starred`/`starredChangedAt` on an entry that already exists locally --
 * whatever the user did to it survives untouched, even when the entry's
 * content changed. See `preserveLocalState` below.
 *
 * Two non-fatal-failure rules added in the Slice 6 correction round:
 *   1. `preserveLocalState` is applied against a state re-read immediately
 *      before the write, not the `existingEntries` snapshot taken before the
 *      fetch/parse `await`s -- otherwise a toggle landing in that window is
 *      silently reverted (Finding 1). See the re-read inside the merge loop
 *      in `refreshOneFeed` below.
 *   2. A retention-prune failure never downgrades an otherwise successful
 *      refresh to `status: "failed"` (Finding 2) -- the feed's content was
 *      already fetched, parsed, and committed by the time pruning runs, and
 *      reporting that as a failure would be exactly the dishonesty this
 *      slice exists to prevent, just inverted.
 */
import { detectsUnstableGuid } from "../domain/identity/entryIdentity";
import type { Entry } from "../domain/models/Entry";
import type { Feed } from "../domain/models/Feed";
import {
  DEFAULT_RETENTION_POLICY,
  selectPrunableEntries,
  type RetentionPolicy,
} from "../domain/retention/prunePolicy";
import type { ClockPort } from "../ports/ClockPort";
import type { FeedFetchErrorCode, FeedSourcePort } from "../ports/FeedSourcePort";
import type { FeedParseErrorCode, FeedParserPort } from "../ports/FeedParserPort";
import type { LocalStorePort } from "../ports/LocalStorePort";

export interface RefreshFeedsDeps {
  readonly feedSource: FeedSourcePort;
  readonly feedParser: FeedParserPort;
  readonly localStore: LocalStorePort;
  readonly clock: ClockPort;
  readonly retentionPolicy?: RetentionPolicy;
  readonly concurrency?: number;
}

export interface FeedRefreshOutcome {
  readonly feedId: string;
  readonly status: "unchanged" | "updated" | "failed";
  readonly entryCount?: number;
  readonly errorCode?: FeedFetchErrorCode | FeedParseErrorCode;
  readonly errorMessage?: string;
  /**
   * Number of retention-prune deletions that failed after an otherwise
   * successful refresh (Finding 2, Slice 6 correction round). A pruning
   * failure is a distinct, non-fatal signal -- it must never downgrade
   * `status` to `"failed"`, since the feed's content was fetched, parsed,
   * and stored successfully. Present only when at least one prune failed.
   */
  readonly pruneFailedCount?: number;
}

export interface RefreshFeedsResult {
  readonly outcomes: readonly FeedRefreshOutcome[];
  readonly failedCount: number;
}

const DEFAULT_CONCURRENCY = 4;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function toPrunable(entry: Entry) {
  return { id: entry.id, read: entry.read, starred: entry.starred, publishedAt: entry.publishedAt };
}

/**
 * Rule 3 of the write-path contract: an incoming, freshly-parsed entry knows
 * nothing about local user state (feedParser always hands back
 * read=0/starred=0/*ChangedAt=null via `createEntry`). When content changed,
 * everything about the entry is replaced EXCEPT these four fields, which are
 * carried forward from the existing local record untouched.
 */
function preserveLocalState(incoming: Entry, existing: Entry, updatedAt: string): Entry {
  return {
    ...incoming,
    read: existing.read,
    readChangedAt: existing.readChangedAt,
    starred: existing.starred,
    starredChangedAt: existing.starredChangedAt,
    updatedAt,
  };
}

async function refreshOneFeed(deps: RefreshFeedsDeps, feed: Feed): Promise<FeedRefreshOutcome> {
  const now = deps.clock.now();
  const fetchResult = await deps.feedSource.fetchFeed(feed.url, {
    etag: feed.etag,
    lastModified: feed.lastModified,
  });

  if (fetchResult.status === "error") {
    // Honest failure (design.md §2): lastFetchedAt advances -- the attempt
    // is recorded -- but lastSuccessAt does NOT. The UI can never claim
    // freshness it does not have.
    await deps.localStore.putFeed({
      ...feed,
      lastFetchedAt: now,
      lastError: { code: fetchResult.code, at: now },
    });
    return { feedId: feed.id, status: "failed", errorCode: fetchResult.code, errorMessage: fetchResult.message };
  }

  if (fetchResult.status === "not-modified") {
    await deps.localStore.putFeed({ ...feed, lastFetchedAt: now, lastSuccessAt: now, lastError: null });
    return { feedId: feed.id, status: "unchanged" };
  }

  const parseResult = deps.feedParser.parse({ body: fetchResult.body, feedId: feed.id, fetchedAt: now });
  if (parseResult.status === "error") {
    await deps.localStore.putFeed({
      ...feed,
      lastFetchedAt: now,
      lastError: { code: parseResult.code, at: now },
    });
    return { feedId: feed.id, status: "failed", errorCode: parseResult.code, errorMessage: parseResult.message };
  }

  const existingEntries = await deps.localStore.listEntriesByFeed(feed.id);
  const existingById = new Map(existingEntries.map((entry) => [entry.id, entry]));

  // Unstable-GUID defense (design.md §3): only evaluated once the feed has a
  // prior successful fetch to compare against.
  let unstableGuid = feed.unstableGuid;
  if (feed.lastSuccessAt !== null && existingEntries.length > 0) {
    const previousIds = existingEntries.map((entry) => entry.id);
    const incomingIds = parseResult.feed.entries.map((entry) => entry.id);
    if (detectsUnstableGuid(previousIds, incomingIds, parseResult.feed.entries.length)) {
      unstableGuid = 1;
    }
  }

  const entriesToWrite: Entry[] = [];
  const finalEntriesById = new Map(existingById);
  for (const incoming of parseResult.feed.entries) {
    const existing = existingById.get(incoming.id);
    if (existing === undefined) {
      entriesToWrite.push(incoming);
      finalEntriesById.set(incoming.id, incoming);
      continue;
    }
    if (existing.contentHash === incoming.contentHash) {
      // No write on unchanged content (design.md §3): avoids churning
      // updatedAt and burning IDB transactions on every poll.
      continue;
    }
    // Finding 1 (Slice 6 correction round): re-read the entry's CURRENT
    // state immediately before merging, instead of trusting the
    // `existingEntries` snapshot taken before the network fetch/parse
    // `await`s above. A `toggleRead`/`toggleStar` write can land in that
    // window; merging against the stale snapshot would silently revert it
    // the moment this refresh also happens to change the entry's content.
    // This does not make the read-then-write atomic -- IndexedDB gives no
    // compare-and-swap primitive through this port -- but it shrinks the
    // race window down to the gap between this read and the write below,
    // instead of spanning the entire fetch+parse duration.
    const current = (await deps.localStore.getEntry(existing.id)) ?? existing;
    const merged = preserveLocalState(incoming, current, now);
    entriesToWrite.push(merged);
    finalEntriesById.set(merged.id, merged);
  }

  const updatedFeed: Feed = {
    ...feed,
    etag: fetchResult.etag,
    lastModified: fetchResult.lastModified,
    lastFetchedAt: now,
    lastSuccessAt: now,
    lastError: null,
    unstableGuid,
  };

  await deps.localStore.putFeedWithEntries(updatedFeed, entriesToWrite);

  // Retention (design.md §3), deferred from Slice 5's subscribeToFeed to
  // here: runs after every successful refresh, over the feed's full
  // post-refresh entry set. `quotaUsageRatio` is left at its default (0),
  // i.e. tier 4's quota-tightened cap (prunePolicy.ts) is implemented but
  // not exercised here -- reading `navigator.storage.estimate()` and
  // passing a live ratio in is not wired, and is a stated follow-up, not
  // silently assumed to already work.
  const prunableIds = selectPrunableEntries(
    [...finalEntriesById.values()].map(toPrunable),
    deps.retentionPolicy ?? DEFAULT_RETENTION_POLICY,
    new Date(now),
  );
  // Finding 2 (Slice 6 correction round): the feed's content was already
  // fetched, parsed, and committed above by the time pruning runs. A prune
  // failure here is a distinct, non-fatal problem -- it must never surface
  // as a failed refresh (that would tell the user their successfully
  // refreshed feed failed). Every prunable id is still attempted; one
  // rejection does not abandon the rest.
  let pruneFailedCount = 0;
  for (const id of prunableIds) {
    try {
      await deps.localStore.deleteEntry(id);
    } catch {
      pruneFailedCount += 1;
    }
  }

  return {
    feedId: feed.id,
    status: "updated",
    entryCount: entriesToWrite.length,
    ...(pruneFailedCount > 0 ? { pruneFailedCount } : {}),
  };
}

export async function refreshFeeds(deps: RefreshFeedsDeps): Promise<RefreshFeedsResult> {
  const feeds = await deps.localStore.listFeeds();
  const concurrency = deps.concurrency ?? DEFAULT_CONCURRENCY;
  const outcomes: FeedRefreshOutcome[] = [];

  for (const batch of chunk(feeds, concurrency)) {
    // Promise.allSettled (feed-fetching spec, "Per-feed error isolation"):
    // `refreshOneFeed` already catches every structured error internally,
    // but allSettled is a second, structural line of defense so a genuinely
    // unexpected throw from one feed still can never reject the whole batch.
    const settled = await Promise.allSettled(batch.map((feed) => refreshOneFeed(deps, feed)));
    settled.forEach((result, index) => {
      if (result.status === "fulfilled") {
        outcomes.push(result.value);
        return;
      }
      const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
      outcomes.push({ feedId: batch[index].id, status: "failed", errorMessage: message });
    });
  }

  return { outcomes, failedCount: outcomes.filter((outcome) => outcome.status === "failed").length };
}
