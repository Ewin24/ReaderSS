import type { Entry } from "../../domain/models/Entry";
import type { LocalStorePort } from "../../ports/LocalStorePort";
import type { ReaderSSDatabase } from "./schema";

/** Highest possible UTF-16 code unit, used as the open upper bound of a string-prefixed key range. */
const MAX_UNICODE_CHAR = String.fromCharCode(0xffff);

/** Thrown by `putEntry` when the entry would produce an invalid compound-index key (Finding 4). */
export class InvalidEntryStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidEntryStateError";
  }
}

/**
 * `by-starred-changed` is a compound index on `[starred, starredChangedAt]`.
 * Per the IndexedDB spec, a compound key is invalid — and the record is
 * SILENTLY OMITTED from that index, no exception — if any member is `null`.
 * `starred: 1` with `starredChangedAt: null` would vanish from
 * `listStarredEntries()` while `getEntry()` still reports it as starred.
 *
 * `by-read-published` is keyed on `[read, publishedAt]`, not
 * `[read, readChangedAt]`, and `publishedAt` is a required non-null field
 * on every `Entry` — so that index cannot suffer the same hazard and
 * `read`/`readChangedAt` needs no equivalent guard here.
 */
function assertValidEntryState(entry: Entry): void {
  if (entry.starred === 1 && entry.starredChangedAt === null) {
    throw new InvalidEntryStateError(
      `entry ${entry.id}: starred=1 requires a non-null starredChangedAt — by-starred-changed is a compound index over [starred, starredChangedAt], and a null member makes the whole key invalid, silently hiding the record from that index`,
    );
  }
}

/**
 * `idb`-backed implementation of {@link LocalStorePort} (design.md §1/§3).
 * Takes an already-open database so `schema.ts` remains the only module
 * responsible for opening, creating, and migrating it.
 */
export function createIdbLocalStore(db: ReaderSSDatabase): LocalStorePort {
  return {
    async getFeed(id) {
      return db.get("feeds", id);
    },
    async listFeeds() {
      return db.getAll("feeds");
    },
    async listFeedsByFolder(folder) {
      return db.getAllFromIndex("feeds", "by-folder", folder);
    },
    async putFeed(feed) {
      await db.put("feeds", feed);
    },
    async deleteFeed(id) {
      const tx = db.transaction(["feeds", "entries"], "readwrite");
      const entriesStore = tx.objectStore("entries");
      const entryIds = await entriesStore.index("by-feed").getAllKeys(id);
      await Promise.all(entryIds.map((entryId) => entriesStore.delete(entryId)));
      await tx.objectStore("feeds").delete(id);
      await tx.done;
    },

    async getEntry(id) {
      return db.get("entries", id);
    },
    async getEntryByFeedAndGuid(feedId, guid) {
      return db.getFromIndex("entries", "by-feed-guid", [feedId, guid]);
    },
    async putEntry(entry) {
      assertValidEntryState(entry);
      await db.put("entries", entry);
    },
    async deleteEntry(id) {
      await db.delete("entries", id);
    },

    async listEntriesByFeed(feedId) {
      return db.getAllFromIndex("entries", "by-feed", feedId);
    },
    async listEntriesByFeedPublished(feedId) {
      const range = IDBKeyRange.bound([feedId, ""], [feedId, MAX_UNICODE_CHAR]);
      const entries = await db.getAllFromIndex("entries", "by-feed-published", range);
      return entries.reverse();
    },
    async listEntriesByPublished() {
      const entries = await db.getAllFromIndex("entries", "by-published");
      return entries.reverse();
    },
    async listUnreadEntries() {
      const range = IDBKeyRange.bound([0, ""], [0, MAX_UNICODE_CHAR]);
      const entries = await db.getAllFromIndex("entries", "by-read-published", range);
      return entries.reverse();
    },
    async listStarredEntries() {
      const range = IDBKeyRange.bound([1, ""], [1, MAX_UNICODE_CHAR]);
      const entries = await db.getAllFromIndex("entries", "by-starred-changed", range);
      return entries.reverse();
    },

    async getConfigValue<T>(key: string) {
      const record = await db.get("config", key);
      return record?.value as T | undefined;
    },
    async putConfigValue(key, value) {
      await db.put("config", { key, value });
    },
  };
}
