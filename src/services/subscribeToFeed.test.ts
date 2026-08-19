import { describe, expect, it, vi } from "vitest";
import { feedParser } from "../adapters/feed/feedParser";
import type { ClockPort } from "../ports/ClockPort";
import type { Feed } from "../domain/models/Feed";
import type { FeedFetchResult, FeedSourcePort } from "../ports/FeedSourcePort";
import type { LocalStorePort } from "../ports/LocalStorePort";
import { subscribeToFeed } from "./subscribeToFeed";

const FIXED_NOW = "2024-06-01T00:00:00.000Z";

function makeClock(): ClockPort {
  return { now: () => FIXED_NOW };
}

function makeLocalStore(overrides: Partial<LocalStorePort> = {}): LocalStorePort {
  return {
    getFeed: vi.fn().mockResolvedValue(undefined),
    listFeeds: vi.fn().mockResolvedValue([]),
    listFeedsByFolder: vi.fn().mockResolvedValue([]),
    putFeed: vi.fn().mockResolvedValue(undefined),
    putFeedWithEntries: vi.fn().mockResolvedValue(undefined),
    deleteFeed: vi.fn().mockResolvedValue(undefined),
    getEntry: vi.fn().mockResolvedValue(undefined),
    getEntryByFeedAndGuid: vi.fn().mockResolvedValue(undefined),
    putEntry: vi.fn().mockResolvedValue(undefined),
    deleteEntry: vi.fn().mockResolvedValue(undefined),
    listEntriesByFeed: vi.fn().mockResolvedValue([]),
    listEntriesByFeedPublished: vi.fn().mockResolvedValue([]),
    listEntriesByPublished: vi.fn().mockResolvedValue([]),
    listUnreadEntries: vi.fn().mockResolvedValue([]),
    listStarredEntries: vi.fn().mockResolvedValue([]),
    getConfigValue: vi.fn().mockResolvedValue(undefined),
    putConfigValue: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeFeedSource(result: FeedFetchResult): FeedSourcePort {
  return { fetchFeed: vi.fn().mockResolvedValue(result) };
}

const VALID_RSS_BODY = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>Example Blog</title>
<link>https://example.com</link>
<description>desc</description>
<item>
<title>Post One</title>
<link>https://example.com/post-1</link>
<guid isPermaLink="false">urn:uuid:abc-123</guid>
<pubDate>Mon, 01 Jan 2024 10:00:00 GMT</pubDate>
<description>Hello</description>
</item>
</channel></rss>`;

describe("subscribeToFeed", () => {
  it("persists a new feed and its entries on the happy path", async () => {
    const localStore = makeLocalStore();
    const feedSource = makeFeedSource({
      status: "updated",
      body: VALID_RSS_BODY,
      contentType: "application/rss+xml",
      etag: '"abc"',
      lastModified: null,
    });

    const result = await subscribeToFeed(
      { feedSource, feedParser, localStore, clock: makeClock() },
      { url: "https://example.com/feed.xml" },
    );

    expect(result.status).toBe("subscribed");
    if (result.status !== "subscribed") return;
    expect(result.feed.title).toBe("Example Blog");
    expect(result.feed.normalizedUrl).toBe("https://example.com/feed.xml");
    expect(result.feed.etag).toBe('"abc"');
    expect(result.entryCount).toBe(1);

    expect(localStore.putFeedWithEntries).toHaveBeenCalledTimes(1);
    const [persistedFeed, persistedEntries] = vi.mocked(localStore.putFeedWithEntries).mock.calls[0];
    expect(persistedFeed.normalizedUrl).toBe("https://example.com/feed.xml");
    expect(persistedEntries).toHaveLength(1);
  });

  it("rejects a URL that is not a feed, and persists nothing", async () => {
    const localStore = makeLocalStore();
    const feedSource = makeFeedSource({
      status: "updated",
      body: "<html><body>not a feed</body></html>",
      contentType: "text/html",
      etag: null,
      lastModified: null,
    });

    const result = await subscribeToFeed(
      { feedSource, feedParser, localStore, clock: makeClock() },
      { url: "https://example.com/not-a-feed" },
    );

    expect(result.status).toBe("not-a-feed");
    expect(localStore.putFeedWithEntries).not.toHaveBeenCalled();
  });

  it("reports an unreachable feed, and persists nothing", async () => {
    const localStore = makeLocalStore();
    const feedSource = makeFeedSource({
      status: "error",
      code: "UPSTREAM_TIMEOUT",
      message: "example.com did not respond within 10s",
    });

    const result = await subscribeToFeed(
      { feedSource, feedParser, localStore, clock: makeClock() },
      { url: "https://example.com/slow-feed.xml" },
    );

    expect(result.status).toBe("unreachable");
    if (result.status !== "unreachable") return;
    expect(result.message).toContain("did not respond");
    expect(localStore.putFeedWithEntries).not.toHaveBeenCalled();
  });

  it("rejects a malformed URL client-side before any network request", async () => {
    const localStore = makeLocalStore();
    const feedSource = makeFeedSource({ status: "error", code: "NETWORK_ERROR", message: "unreachable" });

    const result = await subscribeToFeed(
      { feedSource, feedParser, localStore, clock: makeClock() },
      { url: "not a url" },
    );

    expect(result.status).toBe("invalid-url");
    expect(feedSource.fetchFeed).not.toHaveBeenCalled();
    expect(localStore.putFeedWithEntries).not.toHaveBeenCalled();
  });

  it("returns a typed persist-failed result, instead of an escaping exception, when the atomic feed+entries write rejects (Finding 1)", async () => {
    const localStore = makeLocalStore({
      putFeedWithEntries: vi.fn().mockRejectedValue(new Error("simulated IndexedDB quota error")),
    });
    const feedSource = makeFeedSource({
      status: "updated",
      body: VALID_RSS_BODY,
      contentType: "application/rss+xml",
      etag: '"abc"',
      lastModified: null,
    });

    const result = await subscribeToFeed(
      { feedSource, feedParser, localStore, clock: makeClock() },
      { url: "https://example.com/feed.xml" },
    );

    expect(result.status).toBe("persist-failed");
    if (result.status !== "persist-failed") return;
    expect(result.message).toContain("simulated IndexedDB quota error");
  });

  it("rejects re-adding an already-subscribed feed without fetching again", async () => {
    const existing: Feed = {
      id: "https://example.com/feed.xml",
      url: "https://example.com/feed.xml",
      normalizedUrl: "https://example.com/feed.xml",
      title: "Example Blog",
      siteUrl: "https://example.com",
      folder: null,
      etag: null,
      lastModified: null,
      lastFetchedAt: null,
      lastSuccessAt: null,
      lastError: null,
      addedAt: "2024-01-01T00:00:00.000Z",
      unstableGuid: 0,
    };
    const localStore = makeLocalStore({ getFeed: vi.fn().mockResolvedValue(existing) });
    const feedSource = makeFeedSource({ status: "error", code: "NETWORK_ERROR", message: "should not be called" });

    // Differs only by trailing slash and host case from the stored feed's
    // normalizedUrl, per feed-subscriptions spec's duplicate scenario.
    const result = await subscribeToFeed(
      { feedSource, feedParser, localStore, clock: makeClock() },
      { url: "HTTPS://EXAMPLE.com/feed.xml" },
    );

    expect(result.status).toBe("duplicate");
    if (result.status !== "duplicate") return;
    expect(result.existing).toBe(existing);
    expect(feedSource.fetchFeed).not.toHaveBeenCalled();
  });
});
