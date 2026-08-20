import { describe, expect, it, vi } from "vitest";
import type { ClockPort } from "../ports/ClockPort";
import type { Entry } from "../domain/models/Entry";
import { createEntry } from "../domain/models/Entry";
import type { Feed } from "../domain/models/Feed";
import { createFeed } from "../domain/models/Feed";
import type { FeedFetchResult, FeedSourcePort } from "../ports/FeedSourcePort";
import type { FeedParserPort, FeedParseResult } from "../ports/FeedParserPort";
import type { LocalStorePort } from "../ports/LocalStorePort";
import { refreshFeeds } from "./refreshFeeds";

const FIXED_NOW = "2024-06-01T00:00:00.000Z";

function makeClock(now = FIXED_NOW): ClockPort {
  return { now: () => now };
}

function makeFeed(overrides: Partial<Feed> = {}): Feed {
  return {
    ...createFeed({
      id: "feed-1",
      url: "https://example.com/feed.xml",
      normalizedUrl: "https://example.com/feed.xml",
      title: "Example Feed",
      addedAt: "2024-01-01T00:00:00.000Z",
    }),
    lastFetchedAt: "2024-05-01T00:00:00.000Z",
    lastSuccessAt: "2024-05-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeEntry(overrides: Partial<Entry> = {}): Entry {
  return {
    ...createEntry({
      id: "feed-1:e1",
      feedId: "feed-1",
      contentHash: "old-hash",
      title: "Old title",
      link: "https://example.com/e1",
      publishedAt: "2024-04-01T00:00:00.000Z",
      fetchedAt: "2024-04-01T00:00:00.000Z",
    }),
    ...overrides,
  };
}

function makeLocalStore(overrides: Partial<LocalStorePort> = {}): LocalStorePort {
  return {
    getFeed: vi.fn(),
    listFeeds: vi.fn().mockResolvedValue([]),
    listFeedsByFolder: vi.fn(),
    putFeed: vi.fn().mockResolvedValue(undefined),
    putFeedWithEntries: vi.fn().mockResolvedValue(undefined),
    deleteFeed: vi.fn(),
    getEntry: vi.fn(),
    getEntryByFeedAndGuid: vi.fn(),
    putEntry: vi.fn().mockResolvedValue(undefined),
    deleteEntry: vi.fn().mockResolvedValue(undefined),
    listEntriesByFeed: vi.fn().mockResolvedValue([]),
    listEntriesByFeedPublished: vi.fn(),
    listEntriesByPublished: vi.fn(),
    listUnreadEntries: vi.fn(),
    listStarredEntries: vi.fn(),
    getConfigValue: vi.fn(),
    putConfigValue: vi.fn(),
    ...overrides,
  } as unknown as LocalStorePort;
}

function makeFeedSource(impl: FeedSourcePort["fetchFeed"]): FeedSourcePort {
  return { fetchFeed: vi.fn(impl) };
}

function makeFeedParser(impl: FeedParserPort["parse"]): FeedParserPort {
  return { parse: vi.fn(impl) };
}

const EMPTY_PARSE_RESULT: FeedParseResult = {
  status: "parsed",
  feed: { title: "Example Feed", siteUrl: null, entries: [] },
};

describe("refreshFeeds", () => {
  it("caps concurrency at 4 in-flight feed fetches", async () => {
    let active = 0;
    let peak = 0;
    const feeds = Array.from({ length: 6 }, (_, i) => makeFeed({ id: `feed-${i}`, url: `https://example.com/${i}.xml` }));
    const feedSource = makeFeedSource(async (): Promise<FeedFetchResult> => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return { status: "not-modified" };
    });
    const localStore = makeLocalStore({ listFeeds: vi.fn().mockResolvedValue(feeds) });

    await refreshFeeds({
      feedSource,
      feedParser: makeFeedParser(() => EMPTY_PARSE_RESULT),
      localStore,
      clock: makeClock(),
    });

    expect(peak).toBeLessThanOrEqual(4);
  });

  it("isolates a per-feed structured error without rejecting the batch, and never advances lastSuccessAt", async () => {
    const failingFeed = makeFeed({ id: "feed-bad", lastSuccessAt: "2024-05-01T00:00:00.000Z" });
    const okFeed = makeFeed({ id: "feed-ok", lastSuccessAt: "2024-05-01T00:00:00.000Z" });
    const feedSource = makeFeedSource(async (url): Promise<FeedFetchResult> =>
      url.includes("feed-bad")
        ? { status: "error", code: "UPSTREAM_TIMEOUT", message: "example.com did not respond within 10s" }
        : { status: "not-modified" },
    );
    const localStore = makeLocalStore({
      listFeeds: vi.fn().mockResolvedValue([
        { ...failingFeed, url: "https://example.com/feed-bad.xml" },
        { ...okFeed, url: "https://example.com/feed-ok.xml" },
      ]),
    });

    const result = await refreshFeeds({
      feedSource,
      feedParser: makeFeedParser(() => EMPTY_PARSE_RESULT),
      localStore,
      clock: makeClock("2024-06-01T00:00:00.000Z"),
    });

    expect(result.failedCount).toBe(1);
    const badOutcome = result.outcomes.find((o) => o.feedId === "feed-bad");
    expect(badOutcome).toEqual(
      expect.objectContaining({ status: "failed", errorCode: "UPSTREAM_TIMEOUT" }),
    );
    const okOutcome = result.outcomes.find((o) => o.feedId === "feed-ok");
    expect(okOutcome).toEqual(expect.objectContaining({ status: "unchanged" }));

    const putFeedCalls = vi.mocked(localStore.putFeed).mock.calls.map(([f]) => f);
    const persistedBadFeed = putFeedCalls.find((f) => f.id === "feed-bad");
    expect(persistedBadFeed?.lastSuccessAt).toBe("2024-05-01T00:00:00.000Z"); // unchanged
    expect(persistedBadFeed?.lastFetchedAt).toBe("2024-06-01T00:00:00.000Z"); // attempt recorded
    expect(persistedBadFeed?.lastError).toEqual({ code: "UPSTREAM_TIMEOUT", at: "2024-06-01T00:00:00.000Z" });
  });

  it("isolates a feed whose fetch throws unexpectedly, without rejecting the batch", async () => {
    const throwingFeed = makeFeed({ id: "feed-throws", url: "https://example.com/throws.xml" });
    const okFeed = makeFeed({ id: "feed-ok2", url: "https://example.com/ok2.xml" });
    const feedSource = makeFeedSource(async (url) => {
      if (url.includes("throws")) throw new Error("unexpected network stack failure");
      return { status: "not-modified" } as FeedFetchResult;
    });
    const localStore = makeLocalStore({ listFeeds: vi.fn().mockResolvedValue([throwingFeed, okFeed]) });

    const result = await refreshFeeds({
      feedSource,
      feedParser: makeFeedParser(() => EMPTY_PARSE_RESULT),
      localStore,
      clock: makeClock(),
    });

    expect(result.outcomes).toHaveLength(2);
    expect(result.outcomes.find((o) => o.feedId === "feed-throws")?.status).toBe("failed");
    expect(result.outcomes.find((o) => o.feedId === "feed-ok2")?.status).toBe("unchanged");
  });

  it("does not write an entry whose contentHash is unchanged", async () => {
    const feed = makeFeed();
    const existing = makeEntry({ contentHash: "same-hash", title: "Unchanged title" });
    const incoming = makeEntry({ contentHash: "same-hash", title: "Unchanged title" });
    const feedSource = makeFeedSource(async (): Promise<FeedFetchResult> => ({
      status: "updated",
      body: "<rss></rss>",
      contentType: "application/rss+xml",
      etag: '"new-etag"',
      lastModified: null,
    }));
    const localStore = makeLocalStore({
      listFeeds: vi.fn().mockResolvedValue([feed]),
      listEntriesByFeed: vi.fn().mockResolvedValue([existing]),
    });

    await refreshFeeds({
      feedSource,
      feedParser: makeFeedParser(() => ({
        status: "parsed",
        feed: { title: feed.title, siteUrl: null, entries: [incoming] },
      })),
      localStore,
      clock: makeClock(),
    });

    expect(localStore.putFeedWithEntries).toHaveBeenCalledTimes(1);
    const [, writtenEntries] = vi.mocked(localStore.putFeedWithEntries).mock.calls[0];
    expect(writtenEntries.find((e) => e.id === existing.id)).toBeUndefined();
  });

  it("preserves read/starred state and their change timestamps exactly when an entry's content changes (write-path rule 3)", async () => {
    const feed = makeFeed();
    const existing = makeEntry({
      contentHash: "old-hash",
      read: 1,
      readChangedAt: "2024-02-01T00:00:00.000Z",
      starred: 1,
      starredChangedAt: "2024-03-01T00:00:00.000Z",
    });
    // A freshly parsed entry from feedParser always has read=0/starred=0 and
    // null change timestamps (createEntry's default) -- it knows nothing
    // about local user state.
    const incoming = makeEntry({ contentHash: "new-hash", title: "Updated title" });
    const feedSource = makeFeedSource(async (): Promise<FeedFetchResult> => ({
      status: "updated",
      body: "<rss></rss>",
      contentType: "application/rss+xml",
      etag: null,
      lastModified: null,
    }));
    const localStore = makeLocalStore({
      listFeeds: vi.fn().mockResolvedValue([feed]),
      listEntriesByFeed: vi.fn().mockResolvedValue([existing]),
    });
    const clockNow = vi.fn().mockReturnValue(FIXED_NOW);

    await refreshFeeds({
      feedSource,
      feedParser: makeFeedParser(() => ({
        status: "parsed",
        feed: { title: feed.title, siteUrl: null, entries: [incoming] },
      })),
      localStore,
      clock: { now: clockNow },
    });

    const [, writtenEntries] = vi.mocked(localStore.putFeedWithEntries).mock.calls[0];
    const written = writtenEntries.find((e) => e.id === existing.id);
    expect(written).toEqual(
      expect.objectContaining({
        read: 1,
        readChangedAt: "2024-02-01T00:00:00.000Z",
        starred: 1,
        starredChangedAt: "2024-03-01T00:00:00.000Z",
        title: "Updated title",
      }),
    );
  });

  it("re-reads an entry's current state immediately before writing, so a toggle that lands during the fetch/parse window is not reverted", async () => {
    const feed = makeFeed();
    const staleExisting = makeEntry({
      contentHash: "old-hash",
      read: 0,
      readChangedAt: null,
      starred: 0,
      starredChangedAt: null,
    });
    // Simulates a toggleRead write that landed in the store *after*
    // `listEntriesByFeed` was read but *before* this refresh's final write --
    // the exact race window this test guards against. If the write merges against
    // the stale `listEntriesByFeed` snapshot instead of re-reading, the
    // user's toggle is silently reverted.
    const freshCurrent = makeEntry({
      contentHash: "old-hash",
      read: 1,
      readChangedAt: "2024-05-15T12:00:00.000Z",
      starred: 0,
      starredChangedAt: null,
    });
    const incoming = makeEntry({ contentHash: "new-hash", title: "Updated title" });
    const feedSource = makeFeedSource(async (): Promise<FeedFetchResult> => ({
      status: "updated",
      body: "<rss></rss>",
      contentType: "application/rss+xml",
      etag: null,
      lastModified: null,
    }));
    const localStore = makeLocalStore({
      listFeeds: vi.fn().mockResolvedValue([feed]),
      listEntriesByFeed: vi.fn().mockResolvedValue([staleExisting]),
      getEntry: vi.fn().mockResolvedValue(freshCurrent),
    });

    await refreshFeeds({
      feedSource,
      feedParser: makeFeedParser(() => ({
        status: "parsed",
        feed: { title: feed.title, siteUrl: null, entries: [incoming] },
      })),
      localStore,
      clock: makeClock(),
    });

    expect(localStore.getEntry).toHaveBeenCalledWith(staleExisting.id);
    const [, writtenEntries] = vi.mocked(localStore.putFeedWithEntries).mock.calls[0];
    const written = writtenEntries.find((e) => e.id === staleExisting.id);
    expect(written).toEqual(
      expect.objectContaining({
        read: 1,
        readChangedAt: "2024-05-15T12:00:00.000Z",
      }),
    );
  });

  it("keeps a refresh's status successful when its retention pruning fails, and still attempts every remaining prune", async () => {
    const feed = makeFeed();
    const oldReadEntry1 = makeEntry({
      id: "feed-1:old-1",
      read: 1,
      starred: 0,
      publishedAt: "2020-01-01T00:00:00.000Z",
      contentHash: "unchanged-1",
    });
    const oldReadEntry2 = makeEntry({
      id: "feed-1:old-2",
      read: 1,
      starred: 0,
      publishedAt: "2020-01-02T00:00:00.000Z",
      contentHash: "unchanged-2",
    });
    const localStore = makeLocalStore({
      listFeeds: vi.fn().mockResolvedValue([feed]),
      listEntriesByFeed: vi.fn().mockResolvedValue([oldReadEntry1, oldReadEntry2]),
      deleteEntry: vi.fn().mockImplementation((id: string) =>
        id === "feed-1:old-1" ? Promise.reject(new Error("IndexedDB quota exceeded")) : Promise.resolve(undefined),
      ),
    });
    const feedSource = makeFeedSource(async (): Promise<FeedFetchResult> => ({
      status: "updated",
      body: "<rss></rss>",
      contentType: "application/rss+xml",
      etag: null,
      lastModified: null,
    }));

    const result = await refreshFeeds({
      feedSource,
      feedParser: makeFeedParser(() => ({
        status: "parsed",
        feed: { title: feed.title, siteUrl: null, entries: [] },
      })),
      localStore,
      clock: makeClock("2024-06-01T00:00:00.000Z"),
    });

    expect(result.failedCount).toBe(0);
    const outcome = result.outcomes.find((o) => o.feedId === feed.id);
    expect(outcome).toEqual(expect.objectContaining({ status: "updated", pruneFailedCount: 1 }));
    // Both prunable entries are attempted, not abandoned at the first failure.
    expect(localStore.deleteEntry).toHaveBeenCalledWith("feed-1:old-1");
    expect(localStore.deleteEntry).toHaveBeenCalledWith("feed-1:old-2");
  });

  it("re-keys a feed with unstable GUIDs, detected via detectsUnstableGuid", async () => {
    const feed = makeFeed({ lastSuccessAt: "2024-05-01T00:00:00.000Z", unstableGuid: 0 });
    const existing = makeEntry({ id: "feed-1:old-id" });
    const incoming = makeEntry({ id: "feed-1:brand-new-id" });
    const feedSource = makeFeedSource(async (): Promise<FeedFetchResult> => ({
      status: "updated",
      body: "<rss></rss>",
      contentType: "application/rss+xml",
      etag: null,
      lastModified: null,
    }));
    const localStore = makeLocalStore({
      listFeeds: vi.fn().mockResolvedValue([feed]),
      listEntriesByFeed: vi.fn().mockResolvedValue([existing]),
    });

    await refreshFeeds({
      feedSource,
      feedParser: makeFeedParser(() => ({
        status: "parsed",
        feed: { title: feed.title, siteUrl: null, entries: [incoming] },
      })),
      localStore,
      clock: makeClock(),
    });

    const [writtenFeed] = vi.mocked(localStore.putFeedWithEntries).mock.calls[0];
    expect(writtenFeed.unstableGuid).toBe(1);
  });

  it("prunes entries flagged by selectPrunableEntries after a successful refresh", async () => {
    const feed = makeFeed();
    const oldReadEntry = makeEntry({
      id: "feed-1:old-read",
      read: 1,
      starred: 0,
      publishedAt: "2020-01-01T00:00:00.000Z", // far past the 90-day age cap
      contentHash: "unchanged",
    });
    const localStore = makeLocalStore({
      listFeeds: vi.fn().mockResolvedValue([feed]),
      listEntriesByFeed: vi.fn().mockResolvedValue([oldReadEntry]),
    });
    const feedSource = makeFeedSource(async (): Promise<FeedFetchResult> => ({
      status: "updated",
      body: "<rss></rss>",
      contentType: "application/rss+xml",
      etag: null,
      lastModified: null,
    }));

    await refreshFeeds({
      feedSource,
      feedParser: makeFeedParser(() => ({
        status: "parsed",
        feed: { title: feed.title, siteUrl: null, entries: [] },
      })),
      localStore,
      clock: makeClock("2024-06-01T00:00:00.000Z"),
    });

    expect(localStore.deleteEntry).toHaveBeenCalledWith("feed-1:old-read");
  });

  it("reports a partial refresh: how many feeds failed, distinctly per feed", async () => {
    const feeds = [
      makeFeed({ id: "f1", url: "https://example.com/f1.xml" }),
      makeFeed({ id: "f2", url: "https://example.com/f2.xml" }),
      makeFeed({ id: "f3", url: "https://example.com/f3.xml" }),
    ];
    const feedSource = makeFeedSource(async (url): Promise<FeedFetchResult> => {
      if (url.includes("f1")) return { status: "error", code: "UPSTREAM_TIMEOUT", message: "f1 timed out" };
      if (url.includes("f2")) return { status: "error", code: "UNSUPPORTED_CONTENT_TYPE", message: "f2 is not a feed" };
      return { status: "not-modified" };
    });
    const localStore = makeLocalStore({ listFeeds: vi.fn().mockResolvedValue(feeds) });

    const result = await refreshFeeds({
      feedSource,
      feedParser: makeFeedParser(() => EMPTY_PARSE_RESULT),
      localStore,
      clock: makeClock(),
    });

    expect(result.failedCount).toBe(2);
    expect(result.outcomes.find((o) => o.feedId === "f1")?.errorMessage).toBe("f1 timed out");
    expect(result.outcomes.find((o) => o.feedId === "f2")?.errorMessage).toBe("f2 is not a feed");
    expect(result.outcomes.find((o) => o.feedId === "f3")?.status).toBe("unchanged");
  });
});
