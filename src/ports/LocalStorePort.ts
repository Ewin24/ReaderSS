import type { Entry } from "../domain/models/Entry";
import type { Feed } from "../domain/models/Feed";

/**
 * Port over the local IndexedDB cache (design.md §3). `adapters/store/idbLocalStore.ts`
 * is the only production implementation; `domain` and `services` depend on this
 * interface only, never on `idb` directly.
 */
export interface LocalStorePort {
  getFeed(id: string): Promise<Feed | undefined>;
  listFeeds(): Promise<Feed[]>;
  listFeedsByFolder(folder: string | null): Promise<Feed[]>;
  putFeed(feed: Feed): Promise<void>;
  /** Deletes the feed and cascades to every entry that belongs to it. */
  deleteFeed(id: string): Promise<void>;

  getEntry(id: string): Promise<Entry | undefined>;
  getEntryByFeedAndGuid(feedId: string, guid: string): Promise<Entry | undefined>;
  putEntry(entry: Entry): Promise<void>;
  deleteEntry(id: string): Promise<void>;
  /**
   * Writes a feed and all of its entries atomically, in one IndexedDB
   * transaction (Finding 1, Slice 5 correction round). `subscribeToFeed`
   * uses this instead of calling `putFeed` + `putEntry` in a loop, so a
   * write failure partway through never leaves the feed persisted with
   * only some of its entries, or entries persisted with no owning feed.
   */
  putFeedWithEntries(feed: Feed, entries: readonly Entry[]): Promise<void>;
  /**
   * Atomically creates a feed and its entries ONLY if no feed with this id
   * already exists, resolving `"duplicate"` instead of silently overwriting
   * when it does (Finding 2, Slice 10b correction round). `subscribeToFeed`
   * uses this for its create path instead of `putFeedWithEntries`: a
   * `getFeed` existence check followed by a separate write is two
   * non-atomic steps, so two same-origin tabs submitting the same feed URL
   * in the same moment could both pass the check and the second would
   * silently win, overwriting the first's data while reporting `subscribed`
   * instead of `duplicate`. `refreshFeeds` keeps using `putFeedWithEntries`
   * unchanged -- a refresh is always an update to an already-existing feed,
   * where "duplicate" would be meaningless.
   */
  addFeedWithEntries(
    feed: Feed,
    entries: readonly Entry[],
  ): Promise<"created" | "duplicate">;

  /** All entries for one feed, unordered (`by-feed`). */
  listEntriesByFeed(feedId: string): Promise<Entry[]>;
  /** One feed's entries, newest first (`by-feed-published`). */
  listEntriesByFeedPublished(feedId: string): Promise<Entry[]>;
  /** All entries across every feed, newest first (`by-published`). */
  listEntriesByPublished(): Promise<Entry[]>;
  /** Unread entries across every feed, newest first (`by-read-published`). */
  listUnreadEntries(): Promise<Entry[]>;
  /** Starred entries across every feed, most recently starred first (`by-starred-changed`). */
  listStarredEntries(): Promise<Entry[]>;

  getConfigValue<T>(key: string): Promise<T | undefined>;
  putConfigValue<T>(key: string, value: T): Promise<void>;
}
