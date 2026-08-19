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

describe("entries — starred/starredChangedAt write guard (Finding 4)", () => {
  it("rejects starred=1 with starredChangedAt=null through the port", async () => {
    await expect(
      store.putEntry(entry({ id: "feed:bad-starred", feedId: "feed", starred: 1 })),
    ).rejects.toThrow(/starredChangedAt/);
  });

  it("demonstrates the underlying hazard when the guard is bypassed: by-starred-changed is a compound index, and a null member silently hides the record from it", async () => {
    // Bypass the port's guard entirely and write straight through the raw
    // db, the way a future bug (e.g. Slice 6's toggleStar forgetting to
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
