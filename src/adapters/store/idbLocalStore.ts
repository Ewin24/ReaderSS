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
    async putFeedWithEntries(feed, entries) {
      // One shared, explicitly-aborted transaction (Finding 1, Slice 5
      // correction round) -- mirrors the pattern `deleteFeed` above already
      // established for a multi-store write. Requests are queued
      // synchronously (no `await` between them) so the transaction stays
      // active for the whole batch; on any failure -- including a state
      // guard rejecting one entry partway through -- the transaction is
      // explicitly aborted so nothing written so far (the feed row or any
      // already-queued entry) survives. Without the explicit `tx.abort()`,
      // throwing alone would NOT roll back requests already queued into an
      // active transaction.
      const tx = db.transaction(["feeds", "entries"], "readwrite");
      const feedsStore = tx.objectStore("feeds");
      const entriesStore = tx.objectStore("entries");
      // Every individual `.put()` request's own promise is tracked here too
      // (not just `tx.done`): `idb` resolves/rejects each request
      // independently, so an explicit `tx.abort()` below rejects ALL of
      // them, not only the transaction-level promise. Not collecting and
      // absorbing every one of them here leaves an unhandled rejection per
      // already-queued request whenever a later entry in the batch fails.
      const pending: Promise<unknown>[] = [];
      try {
        pending.push(feedsStore.put(feed));
        for (const entry of entries) {
          assertValidEntryState(entry);
          pending.push(entriesStore.put(entry));
        }
        await Promise.all(pending);
        await tx.done;
      } catch (error) {
        tx.abort();
        await Promise.allSettled([...pending, tx.done]);
        throw error;
      }
    },
    async addFeedWithEntries(feed, entries) {
      // Mirrors `putFeedWithEntries`'s own transaction pattern (requests
      // queued synchronously, explicit try/catch/abort), but the FIRST
      // queued request is `feedsStore.add()` rather than `.put()` --
      // IndexedDB's own atomic, keyed uniqueness check (Finding 2, Slice
      // 10b correction round). `add()` rejects with `ConstraintError` if a
      // record with this key already exists, and per the IndexedDB spec an
      // unhandled request error auto-aborts the transaction, so nothing
      // queued here (the `add` itself, or any entry `put`) survives either
      // way -- the same rollback guarantee `putFeedWithEntries` documents.
      const tx = db.transaction(["feeds", "entries"], "readwrite");
      const feedsStore = tx.objectStore("feeds");
      const entriesStore = tx.objectStore("entries");
      const pending: Promise<unknown>[] = [];
      try {
        pending.push(feedsStore.add(feed));
        for (const entry of entries) {
          assertValidEntryState(entry);
          pending.push(entriesStore.put(entry));
        }
        await Promise.all(pending);
        await tx.done;
        return "created";
      } catch (error) {
        try {
          tx.abort();
        } catch {
          // Already aborting/aborted -- the common `ConstraintError` case,
          // where the native default action already began the abort before
          // this catch block runs. Nothing further to do.
        }
        await Promise.allSettled([...pending, tx.done]);
        if (error instanceof DOMException && error.name === "ConstraintError") {
          return "duplicate";
        }
        throw error;
      }
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
