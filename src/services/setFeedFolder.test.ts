import { describe, expect, it, vi } from "vitest";
import { createFeed, type Feed } from "../domain/models/Feed";
import type { LocalStorePort } from "../ports/LocalStorePort";
import { setFeedFolder } from "./setFeedFolder";

const FEED_ID = "https://example.com/feed";

function makeFeed(overrides: Partial<Feed> = {}): Feed {
  return {
    ...createFeed({
      id: FEED_ID,
      url: FEED_ID,
      normalizedUrl: FEED_ID,
      title: "Example",
      folder: null,
      addedAt: "2024-06-01T00:00:00.000Z",
    }),
    ...overrides,
  };
}

function makeDeps(feed: Feed | undefined, putFeed = vi.fn().mockResolvedValue(undefined)) {
  const localStore = { getFeed: vi.fn().mockResolvedValue(feed), putFeed } as unknown as LocalStorePort;
  return { deps: { localStore }, putFeed };
}

describe("setFeedFolder", () => {
  it("files an ungrouped feed into a collection", async () => {
    const { deps, putFeed } = makeDeps(makeFeed());

    const result = await setFeedFolder(deps, FEED_ID, "Comics");

    expect(result).toEqual({ status: "saved", folder: "Comics" });
    expect(putFeed).toHaveBeenCalledWith(expect.objectContaining({ folder: "Comics" }));
  });

  it("moves a feed from one collection to another", async () => {
    const { deps, putFeed } = makeDeps(makeFeed({ folder: "Tech" }));

    await setFeedFolder(deps, FEED_ID, "Comics");

    expect(putFeed).toHaveBeenCalledWith(expect.objectContaining({ folder: "Comics" }));
  });

  it("trims the collection name", async () => {
    const { deps, putFeed } = makeDeps(makeFeed());

    await setFeedFolder(deps, FEED_ID, "  Comics  ");

    expect(putFeed).toHaveBeenCalledWith(expect.objectContaining({ folder: "Comics" }));
  });

  it.each([
    ["null", null],
    ["an empty string", ""],
    ["only whitespace", "   "],
  ])("takes the feed out of its collection for %s", async (_label, input) => {
    const { deps, putFeed } = makeDeps(makeFeed({ folder: "Tech" }));

    const result = await setFeedFolder(deps, FEED_ID, input);

    expect(result).toEqual({ status: "saved", folder: null });
    expect(putFeed).toHaveBeenCalledWith(expect.objectContaining({ folder: null }));
  });

  it("changes ONLY the folder, leaving the note and fetch bookkeeping untouched", async () => {
    const feed = makeFeed({
      note: "my note",
      etag: 'W/"abc"',
      lastModified: "Mon, 01 Jan 2024 10:00:00 GMT",
      lastFetchedAt: "2024-06-02T00:00:00.000Z",
      lastError: { code: "FETCH_FAILED", at: "2024-06-01T00:00:00.000Z" },
    });
    const { deps, putFeed } = makeDeps(feed);

    await setFeedFolder(deps, FEED_ID, "Comics");

    expect(putFeed).toHaveBeenCalledWith({ ...feed, folder: "Comics" });
  });

  it("reports a feed that no longer exists instead of writing a new one", async () => {
    const { deps, putFeed } = makeDeps(undefined);

    expect(await setFeedFolder(deps, FEED_ID, "Comics")).toEqual({ status: "not-found" });
    expect(putFeed).not.toHaveBeenCalled();
  });

  it("reports a failed write as a typed result rather than throwing", async () => {
    const { deps } = makeDeps(makeFeed(), vi.fn().mockRejectedValue(new Error("quota exceeded")));

    const result = await setFeedFolder(deps, FEED_ID, "Comics");

    expect(result).toEqual({ status: "error", message: expect.stringContaining("quota exceeded") });
  });
});
