import { describe, expect, it, vi } from "vitest";
import { createEntry, type Entry } from "../domain/models/Entry";
import { createFeed, type Feed } from "../domain/models/Feed";
import type { LocalStorePort } from "../ports/LocalStorePort";
import { searchLibrary } from "./searchLibrary";

function makeFeed(overrides: Partial<Feed> & { id: string }): Feed {
  return {
    ...createFeed({
      id: overrides.id,
      url: overrides.id,
      normalizedUrl: overrides.id,
      title: "A feed",
      folder: null,
      addedAt: "2026-08-01T00:00:00.000Z",
    }),
    ...overrides,
  };
}

function makeEntry(overrides: Partial<Entry> & { id: string }): Entry {
  return {
    ...createEntry({
      id: overrides.id,
      feedId: "feed-1",
      contentHash: overrides.id,
      title: "An entry",
      link: `https://example.com/${overrides.id}`,
      publishedAt: "2026-08-01T00:00:00.000Z",
      fetchedAt: "2026-08-01T00:00:00.000Z",
    }),
    ...overrides,
  };
}

function makeStore(overrides: Partial<LocalStorePort> = {}): LocalStorePort {
  return {
    listFeeds: vi.fn().mockResolvedValue([]),
    listEntriesByPublished: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as LocalStorePort;
}

describe("searchLibrary", () => {
  it("searches feeds and entries from the store", async () => {
    const localStore = makeStore({
      listFeeds: vi.fn().mockResolvedValue([makeFeed({ id: "feed-1", title: "Hacker News" })]),
      listEntriesByPublished: vi
        .fn()
        .mockResolvedValue([makeEntry({ id: "e1", title: "Kafka in practice" })]),
    });

    const result = await searchLibrary({ localStore }, "kafka");

    expect(result.status).toBe("ok");
    expect(result.status === "ok" && result.outcome.results).toHaveLength(1);
  });

  it("searches EVERY feed, not only the one being read", async () => {
    // This is the whole point of the feature: `listEntriesByPublished` spans
    // the library, where the entry list only ever holds one feed.
    const localStore = makeStore();

    await searchLibrary({ localStore }, "anything");

    expect(localStore.listEntriesByPublished).toHaveBeenCalledTimes(1);
  });

  it("searches the full content when a feed sends it, the summary otherwise", async () => {
    const localStore = makeStore({
      listEntriesByPublished: vi.fn().mockResolvedValue([
        makeEntry({
          id: "full",
          title: "Untitled",
          contentHtml: "<p>needle in the content</p>",
          summaryHtml: "<p>nothing</p>",
        }),
        makeEntry({ id: "summary-only", title: "Untitled", summaryHtml: "<p>needle again</p>" }),
      ]),
    });

    const result = await searchLibrary({ localStore }, "needle");

    expect(result.status === "ok" && result.outcome.results.map((r) => r.kind)).toEqual([
      "entry",
      "entry",
    ]);
  });

  it("searches the note you wrote on a feed", async () => {
    const localStore = makeStore({
      listFeeds: vi
        .fn()
        .mockResolvedValue([makeFeed({ id: "feed-1", title: "lobste.rs", note: "Rust things" })]),
    });

    const result = await searchLibrary({ localStore }, "rust things");

    expect(result.status === "ok" && result.outcome.results[0]).toMatchObject({
      kind: "feed",
      matchedIn: "note",
    });
  });

  it("does not read the store at all for a query too short to match", async () => {
    // A read of the whole library on the way to a guaranteed empty answer is
    // pure cost, and it happens on the first keystroke of every search.
    const localStore = makeStore();

    const result = await searchLibrary({ localStore }, "k");

    expect(localStore.listFeeds).not.toHaveBeenCalled();
    expect(localStore.listEntriesByPublished).not.toHaveBeenCalled();
    expect(result.status === "ok" && result.outcome.results).toHaveLength(0);
  });

  it("reports a store failure instead of throwing", async () => {
    const localStore = makeStore({
      listEntriesByPublished: vi.fn().mockRejectedValue(new Error("IndexedDB is gone")),
    });

    const result = await searchLibrary({ localStore }, "kafka");

    expect(result).toEqual({
      status: "error",
      query: "kafka",
      message: expect.stringContaining("IndexedDB is gone"),
    });
  });

  it("passes an explicit limit through to the search", async () => {
    const localStore = makeStore({
      listEntriesByPublished: vi
        .fn()
        .mockResolvedValue(
          Array.from({ length: 5 }, (_, index) =>
            makeEntry({ id: `e${index}`, title: `Kafka ${index}` }),
          ),
        ),
    });

    const result = await searchLibrary({ localStore }, "kafka", { limit: 2 });

    expect(result.status === "ok" && result.outcome.results).toHaveLength(2);
    expect(result.status === "ok" && result.outcome.totalCount).toBe(5);
  });

  it("echoes the trimmed query so a stale response can be dropped", async () => {
    const result = await searchLibrary({ localStore: makeStore() }, "  kafka  ");

    expect(result.status === "ok" && result.outcome.query).toBe("kafka");
  });
});
