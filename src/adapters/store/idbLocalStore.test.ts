import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEntry, type Entry } from "../../domain/models/Entry";
import { createFeed, type Feed } from "../../domain/models/Feed";
import { openReaderSSDatabase, type ReaderSSDatabase } from "./schema";
import { createIdbLocalStore } from "./idbLocalStore";
import type { LocalStorePort } from "../../ports/LocalStorePort";

let db: ReaderSSDatabase;
let store: LocalStorePort;

beforeEach(async () => {
  db = await openReaderSSDatabase();
  store = createIdbLocalStore(db);
});

afterEach(() => {
  db.close();
});

function feed(overrides: Partial<Feed> & { id: string }): Feed {
  return {
    ...createFeed({
      id: overrides.id,
      url: overrides.id,
      normalizedUrl: overrides.id,
      title: "Feed",
      addedAt: "2026-08-01T00:00:00.000Z",
    }),
    ...overrides,
  };
}

function entry(overrides: Partial<Entry> & { id: string; feedId: string }): Entry {
  return {
    ...createEntry({
      id: overrides.id,
      feedId: overrides.feedId,
      contentHash: "hash",
      title: "Entry",
      link: `${overrides.feedId}/${overrides.id}`,
      publishedAt: "2026-08-19T00:00:00.000Z",
      fetchedAt: "2026-08-19T00:00:00.000Z",
    }),
    ...overrides,
  };
}

describe("feeds — CRUD and by-folder", () => {
  it("writes, reads, and lists feeds", async () => {
    await store.putFeed(feed({ id: "https://a.example/feed.xml", folder: "News" }));
    await store.putFeed(feed({ id: "https://b.example/feed.xml", folder: "Tech" }));

    const a = await store.getFeed("https://a.example/feed.xml");
    expect(a?.folder).toBe("News");

    const all = await store.listFeeds();
    expect(all).toHaveLength(2);
  });

  it("lists feeds by folder via the by-folder index", async () => {
    await store.putFeed(feed({ id: "https://a.example/feed.xml", folder: "News" }));
    await store.putFeed(feed({ id: "https://b.example/feed.xml", folder: "Tech" }));
    await store.putFeed(feed({ id: "https://c.example/feed.xml", folder: "News" }));

    const newsFeeds = await store.listFeedsByFolder("News");

    expect(newsFeeds.map((f) => f.id).sort()).toEqual([
      "https://a.example/feed.xml",
      "https://c.example/feed.xml",
    ]);
  });

  it("deleting a feed cascades to its entries", async () => {
    await store.putFeed(feed({ id: "https://a.example/feed.xml" }));
    await store.putEntry(entry({ id: "https://a.example/feed.xml:1", feedId: "https://a.example/feed.xml" }));
    await store.putEntry(entry({ id: "https://a.example/feed.xml:2", feedId: "https://a.example/feed.xml" }));

    await store.deleteFeed("https://a.example/feed.xml");

    expect(await store.getFeed("https://a.example/feed.xml")).toBeUndefined();
    expect(await store.listEntriesByFeed("https://a.example/feed.xml")).toHaveLength(0);
  });
});

describe("entries — CRUD and by-feed / by-feed-guid", () => {
  it("writes and reads a single entry", async () => {
    await store.putEntry(entry({ id: "feed:1", feedId: "feed", guid: "g1" }));

    const found = await store.getEntry("feed:1");
    expect(found?.guid).toBe("g1");
  });

  it("deletes a single entry", async () => {
    await store.putEntry(entry({ id: "feed:1", feedId: "feed" }));

    await store.deleteEntry("feed:1");

    expect(await store.getEntry("feed:1")).toBeUndefined();
  });

  it("lists entries for one feed via by-feed, excluding other feeds' entries", async () => {
    await store.putEntry(entry({ id: "feedA:1", feedId: "feedA" }));
    await store.putEntry(entry({ id: "feedA:2", feedId: "feedA" }));
    await store.putEntry(entry({ id: "feedB:1", feedId: "feedB" }));

    const feedAEntries = await store.listEntriesByFeed("feedA");

    expect(feedAEntries.map((e) => e.id).sort()).toEqual(["feedA:1", "feedA:2"]);
  });

  it("finds an entry by feed + guid via by-feed-guid", async () => {
    await store.putEntry(entry({ id: "feedA:1", feedId: "feedA", guid: "g1" }));
    await store.putEntry(entry({ id: "feedB:1", feedId: "feedB", guid: "g1" }));

    const found = await store.getEntryByFeedAndGuid("feedA", "g1");

    expect(found?.id).toBe("feedA:1");
  });
});

describe("entries — publish-order indexes", () => {
  beforeEach(async () => {
    await store.putEntry(
      entry({ id: "feed:old", feedId: "feed", publishedAt: "2026-08-01T00:00:00.000Z" }),
    );
    await store.putEntry(
      entry({ id: "feed:new", feedId: "feed", publishedAt: "2026-08-19T00:00:00.000Z" }),
    );
  });

  it("lists one feed's entries newest-first via by-feed-published", async () => {
    const result = await store.listEntriesByFeedPublished("feed");

    expect(result.map((e) => e.id)).toEqual(["feed:new", "feed:old"]);
  });

  it("lists all entries newest-first via by-published", async () => {
    const result = await store.listEntriesByPublished();

    expect(result.map((e) => e.id)).toEqual(["feed:new", "feed:old"]);
  });
});

describe("entries — read/starred indexes", () => {
  it("lists only unread entries via by-read-published", async () => {
    await store.putEntry(entry({ id: "feed:unread", feedId: "feed", read: 0 }));
    await store.putEntry(entry({ id: "feed:read", feedId: "feed", read: 1 }));

    const unread = await store.listUnreadEntries();

    expect(unread.map((e) => e.id)).toEqual(["feed:unread"]);
  });

  it("lists only starred entries via by-starred-changed", async () => {
    await store.putEntry(
      entry({
        id: "feed:starred",
        feedId: "feed",
        starred: 1,
        starredChangedAt: "2026-08-19T00:00:00.000Z",
      }),
    );
    await store.putEntry(entry({ id: "feed:plain", feedId: "feed", starred: 0 }));

    const starred = await store.listStarredEntries();

    expect(starred.map((e) => e.id)).toEqual(["feed:starred"]);
  });
});

describe("entries — starred/starredChangedAt write guard", () => {
  it("rejects starred=1 with starredChangedAt=null through the port", async () => {
    await expect(
      store.putEntry(entry({ id: "feed:bad-starred", feedId: "feed", starred: 1 })),
    ).rejects.toThrow(/starredChangedAt/);
  });

  it("demonstrates the underlying hazard when the guard is bypassed: by-starred-changed is a compound index, and a null member silently hides the record from it", async () => {
    // Bypass the port's guard entirely and write straight through the raw
    // db, the way a future bug (e.g. toggleStar forgetting to
    // stamp the timestamp) would.
    await db.put("entries", entry({ id: "feed:hidden-starred", feedId: "feed", starred: 1 }));

    // The record IS there...
    const direct = await db.get("entries", "feed:hidden-starred");
    expect(direct?.starred).toBe(1);

    // ...but it never appears in the starred index: a null compound-index
    // member makes the whole key invalid, and IndexedDB silently omits the
    // record instead of throwing.
    const viaIndex = await store.listStarredEntries();
    expect(viaIndex.map((e) => e.id)).not.toContain("feed:hidden-starred");
  });
});

describe("putFeedWithEntries — atomic feed+entries write", () => {
  it("persists the feed and every entry together in one transaction", async () => {
    const f = feed({ id: "https://atomic.example/feed.xml" });
    const e1 = entry({ id: "https://atomic.example/feed.xml:1", feedId: f.id });
    const e2 = entry({ id: "https://atomic.example/feed.xml:2", feedId: f.id });

    await store.putFeedWithEntries(f, [e1, e2]);

    expect(await store.getFeed(f.id)).toEqual(f);
    expect((await store.listEntriesByFeed(f.id)).map((e) => e.id).sort()).toEqual([e1.id, e2.id]);
  });

  it("rolls back the feed AND every already-queued entry when a later entry in the batch is invalid", async () => {
    const f = feed({ id: "https://rollback.example/feed.xml" });
    const validEntry = entry({ id: "https://rollback.example/feed.xml:1", feedId: f.id });
    // The same invalid shape `assertValidEntryState` already rejects
    // through `putEntry`: starred=1 with a null starredChangedAt.
    const invalidEntry = entry({
      id: "https://rollback.example/feed.xml:2",
      feedId: f.id,
      starred: 1,
    });

    await expect(store.putFeedWithEntries(f, [validEntry, invalidEntry])).rejects.toThrow(
      /starredChangedAt/,
    );

    // Not a partial write: the feed row and the entry that WAS valid must
    // both be rolled back along with the invalid one -- this is the
    // atomicity `putFeedWithEntries` adds, replacing
    // the previous independent-auto-committing `putFeed` + `putEntry` loop.
    expect(await store.getFeed(f.id)).toBeUndefined();
    expect(await store.getEntry(validEntry.id)).toBeUndefined();
    expect(await store.getEntry(invalidEntry.id)).toBeUndefined();
  });
});

describe("addFeedWithEntries — atomic create-only write", () => {
  it("persists the feed and every entry together, the same as putFeedWithEntries, when no feed with this id exists yet", async () => {
    const f = feed({ id: "https://atomic-add.example/feed.xml" });
    const e1 = entry({ id: "https://atomic-add.example/feed.xml:1", feedId: f.id });

    const result = await store.addFeedWithEntries(f, [e1]);

    expect(result).toBe("created");
    expect(await store.getFeed(f.id)).toEqual(f);
    expect((await store.listEntriesByFeed(f.id)).map((e) => e.id)).toEqual([e1.id]);
  });

  it("rejects with 'duplicate' instead of overwriting, when a feed with this id already exists, closing a two-tab race", async () => {
    const f = feed({ id: "https://race.example/feed.xml", title: "First writer's title" });
    const firstEntry = entry({ id: "https://race.example/feed.xml:1", feedId: f.id });
    await store.addFeedWithEntries(f, [firstEntry]);

    // Simulates a second same-origin tab (or any concurrent caller) that
    // evaluated "does this feed exist?" before the first writer's add above
    // committed, and now attempts to create the same id with DIFFERENT
    // content -- the exact shape of the pre-fix race `subscribeToFeed`'s
    // `getFeed` + `putFeedWithEntries` could lose silently.
    const second = feed({ id: f.id, title: "Second writer's title (must not win)" });
    const secondEntry = entry({ id: "https://race.example/feed.xml:2", feedId: f.id });

    const result = await store.addFeedWithEntries(second, [secondEntry]);

    expect(result).toBe("duplicate");
    // The first writer's row survives untouched -- neither its feed row nor
    // its entry was overwritten or partially merged.
    expect(await store.getFeed(f.id)).toEqual(f);
    expect(await store.getEntry(firstEntry.id)).toBeDefined();
    // The second writer's entry must never have been persisted either --
    // an atomic "created XOR duplicate" outcome, not a partial write.
    expect(await store.getEntry(secondEntry.id)).toBeUndefined();
  });

  it("rolls back the feed row too when a later entry in the batch is invalid, same as putFeedWithEntries's own guarantee", async () => {
    const f = feed({ id: "https://atomic-add-rollback.example/feed.xml" });
    const validEntry = entry({ id: "https://atomic-add-rollback.example/feed.xml:1", feedId: f.id });
    const invalidEntry = entry({
      id: "https://atomic-add-rollback.example/feed.xml:2",
      feedId: f.id,
      starred: 1,
    });

    await expect(store.addFeedWithEntries(f, [validEntry, invalidEntry])).rejects.toThrow(
      /starredChangedAt/,
    );

    expect(await store.getFeed(f.id)).toBeUndefined();
    expect(await store.getEntry(validEntry.id)).toBeUndefined();
  });
});

describe("config — key/value store", () => {
  it("round-trips an arbitrary config value by key", async () => {
    await store.putConfigValue("ui", { layout: "split" });

    const value = await store.getConfigValue<{ layout: string }>("ui");

    expect(value).toEqual({ layout: "split" });
  });

  it("returns undefined for a key that was never written", async () => {
    const value = await store.getConfigValue("missing");

    expect(value).toBeUndefined();
  });
});
