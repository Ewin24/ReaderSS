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
