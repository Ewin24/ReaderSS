/**
 * Import is orchestration, so these tests are about the orchestration
 * guarantees, not about parsing (covered in `domain/opml/`) or subscribing
 * (covered in `subscribeToFeed.test.ts`):
 *
 * - every listed feed goes through the REAL `subscribeToFeed`, folder and all;
 * - one bad feed never stops the rest;
 * - requests go out one at a time, not all at once;
 * - progress is reported as it happens, not only at the end;
 * - cancelling stops further work and keeps what was already added.
 */
import { describe, expect, it, vi } from "vitest";
import { feedParser } from "../adapters/feed/feedParser";
import { feedsmithOpmlCodec } from "../adapters/opml/feedsmithOpmlCodec";
import type { ClockPort } from "../ports/ClockPort";
import type { FeedFetchResult, FeedSourcePort } from "../ports/FeedSourcePort";
import type { LocalStorePort } from "../ports/LocalStorePort";
import { importOpml, type ImportOpmlDeps } from "./importOpml";

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
    addFeedWithEntries: vi.fn().mockResolvedValue("created"),
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
  } as LocalStorePort;
}

const VALID_RSS_BODY = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>Example Blog</title>
<link>https://example.com</link>
<description>desc</description>
<item><title>Post One</title><link>https://example.com/post-1</link></item>
</channel></rss>`;

function okFetch(): FeedFetchResult {
  return {
    status: "updated",
    body: VALID_RSS_BODY,
    contentType: "application/rss+xml",
    etag: null,
    lastModified: null,
  };
}

function makeDeps(
  fetchFeed: FeedSourcePort["fetchFeed"],
  localStore: LocalStorePort = makeLocalStore(),
): ImportOpmlDeps {
  return {
    feedSource: { fetchFeed },
    feedParser,
    localStore,
    clock: makeClock(),
    opmlCodec: feedsmithOpmlCodec,
  };
}

const TWO_FEEDS_OPML = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>Subs</title></head>
  <body>
    <outline text="Tech">
      <outline type="rss" text="One" xmlUrl="https://one.example.com/feed.xml"/>
    </outline>
    <outline type="rss" text="Two" xmlUrl="https://two.example.com/feed.xml"/>
  </body>
</opml>`;

describe("importOpml", () => {
  it("reports an unreadable file instead of throwing", async () => {
    const result = await importOpml(makeDeps(vi.fn()), "this is not opml");

    expect(result.status).toBe("invalid-file");
    if (result.status !== "invalid-file") return;
    expect(result.message.length).toBeGreaterThan(0);
  });

  it("reports a valid file that lists no usable feed", async () => {
    const noFeeds = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0"><head><title>Subs</title></head>
<body><outline text="Just a folder"><outline text="Just a label"/></outline></body></opml>`;

    expect((await importOpml(makeDeps(vi.fn()), noFeeds)).status).toBe("no-feeds");
  });

  it("subscribes to every listed feed, carrying its OPML folder through", async () => {
    const localStore = makeLocalStore();
    const deps = makeDeps(vi.fn().mockResolvedValue(okFetch()), localStore);

    const result = await importOpml(deps, TWO_FEEDS_OPML);

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.summary).toEqual({ added: 2, duplicates: 0, failed: 0, cancelled: 0 });

    const written = (localStore.addFeedWithEntries as ReturnType<typeof vi.fn>).mock.calls;
    expect(written).toHaveLength(2);
    expect(written[0][0]).toMatchObject({ folder: "Tech" });
    expect(written[1][0]).toMatchObject({ folder: null });
  });

  it("keeps going when one feed fails, and reports each outcome separately", async () => {
    const fetchFeed = vi
      .fn()
      .mockResolvedValueOnce({ status: "error", code: "FETCH_FAILED", message: "boom" })
      .mockResolvedValueOnce(okFetch());

    const result = await importOpml(makeDeps(fetchFeed), TWO_FEEDS_OPML);

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.summary).toMatchObject({ added: 1, failed: 1 });
    expect(result.outcomes[0].status).not.toBe("subscribed");
    expect(result.outcomes[1].status).toBe("subscribed");
  });

  it("survives a rejection from the subscribe path rather than aborting the import", async () => {
    const fetchFeed = vi
      .fn()
      .mockRejectedValueOnce(new Error("adapter exploded"))
      .mockResolvedValueOnce(okFetch());

    const result = await importOpml(makeDeps(fetchFeed), TWO_FEEDS_OPML);

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.outcomes[0].message).toContain("adapter exploded");
    expect(result.outcomes[1].status).toBe("subscribed");
  });

  it("counts an already-subscribed feed as a duplicate, not a failure", async () => {
    const localStore = makeLocalStore({
      addFeedWithEntries: vi.fn().mockResolvedValue("duplicate"),
    });
    const deps = makeDeps(vi.fn().mockResolvedValue(okFetch()), localStore);

    const result = await importOpml(deps, TWO_FEEDS_OPML);

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.summary).toMatchObject({ added: 0, duplicates: 2, failed: 0 });
  });

  it("fetches one feed at a time rather than all at once", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchFeed = vi.fn().mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 0));
      inFlight -= 1;
      return okFetch();
    });

    await importOpml(makeDeps(fetchFeed), TWO_FEEDS_OPML);

    expect(fetchFeed).toHaveBeenCalledTimes(2);
    expect(maxInFlight).toBe(1);
  });

  it("reports progress as each feed settles, not only at the end", async () => {
    const onProgress = vi.fn();

    await importOpml(makeDeps(vi.fn().mockResolvedValue(okFetch())), TWO_FEEDS_OPML, {
      onProgress,
    });

    expect(onProgress.mock.calls).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });

  it("stops at the next feed when cancelled, and keeps what was already added", async () => {
    const controller = new AbortController();
    const fetchFeed = vi.fn().mockImplementation(async () => {
      controller.abort(); // cancel while the FIRST feed is in flight
      return okFetch();
    });

    const result = await importOpml(makeDeps(fetchFeed), TWO_FEEDS_OPML, {
      signal: controller.signal,
    });

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(fetchFeed).toHaveBeenCalledTimes(1);
    expect(result.outcomes[0].status).toBe("subscribed");
    expect(result.outcomes[1].status).toBe("cancelled");
    expect(result.summary).toMatchObject({ added: 1, cancelled: 1 });
  });

  it("ignores a feed listed twice in the same file", async () => {
    const twice = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0"><head><title>Subs</title></head><body>
<outline type="rss" text="One" xmlUrl="https://one.example.com/feed.xml"/>
<outline type="rss" text="One again" xmlUrl="https://one.example.com/feed.xml/"/>
</body></opml>`;
    const fetchFeed = vi.fn().mockResolvedValue(okFetch());

    const result = await importOpml(makeDeps(fetchFeed), twice);

    expect(fetchFeed).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.outcomes).toHaveLength(1);
  });
});

describe("importOpml — feed notes", () => {
  const WITH_DESCRIPTIONS = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>Subs</title></head>
  <body>
    <outline text="Tech" description="A folder-level note.">
      <outline type="rss" text="One" xmlUrl="https://one.example.com/feed.xml"
        description="Long-form only. Skip the deal posts."/>
    </outline>
    <outline type="rss" text="Two" xmlUrl="https://two.example.com/feed.xml"/>
  </body>
</opml>`;

  it("carries a feed's description into its stored note", async () => {
    const localStore = makeLocalStore();
    const deps = makeDeps(vi.fn().mockResolvedValue(okFetch()), localStore);

    await importOpml(deps, WITH_DESCRIPTIONS);

    const written = (localStore.addFeedWithEntries as ReturnType<typeof vi.fn>).mock.calls;
    expect(written[0][0]).toMatchObject({ note: "Long-form only. Skip the deal posts." });
  });

  it("leaves a feed with no description with no note", async () => {
    const localStore = makeLocalStore();
    const deps = makeDeps(vi.fn().mockResolvedValue(okFetch()), localStore);

    await importOpml(deps, WITH_DESCRIPTIONS);

    const written = (localStore.addFeedWithEntries as ReturnType<typeof vi.fn>).mock.calls;
    expect(written[1][0]).toMatchObject({ note: null });
  });

  it("does NOT inherit the enclosing folder's description as the feed's note", async () => {
    // "Two" is outside the folder; "One" is inside it and has its own note.
    // Neither ends up carrying the folder's text.
    const localStore = makeLocalStore();
    const deps = makeDeps(vi.fn().mockResolvedValue(okFetch()), localStore);

    await importOpml(deps, WITH_DESCRIPTIONS);

    const written = (localStore.addFeedWithEntries as ReturnType<typeof vi.fn>).mock.calls;
    expect(written.map((call) => call[0].note)).not.toContain("A folder-level note.");
  });
});
