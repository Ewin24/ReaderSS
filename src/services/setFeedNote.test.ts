import { describe, expect, it, vi } from "vitest";
import { createFeed, type Feed } from "../domain/models/Feed";
import type { LocalStorePort } from "../ports/LocalStorePort";
import { setFeedNote } from "./setFeedNote";

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
  const localStore = {
    getFeed: vi.fn().mockResolvedValue(feed),
    putFeed,
  } as unknown as LocalStorePort;
  return { deps: { localStore }, putFeed };
}

describe("setFeedNote", () => {
  it("saves the note onto the feed", async () => {
    const { deps, putFeed } = makeDeps(makeFeed());

    const result = await setFeedNote(deps, FEED_ID, "Only long-form pieces, skip the news.");

    expect(result).toEqual({ status: "saved", note: "Only long-form pieces, skip the news." });
    expect(putFeed).toHaveBeenCalledWith(
      expect.objectContaining({ id: FEED_ID, note: "Only long-form pieces, skip the news." }),
    );
  });

  it("trims surrounding whitespace", async () => {
    const { deps, putFeed } = makeDeps(makeFeed());

    await setFeedNote(deps, FEED_ID, "   keep this   ");

    expect(putFeed).toHaveBeenCalledWith(expect.objectContaining({ note: "keep this" }));
  });

  it.each([["an empty string", ""], ["only whitespace", "   \n  "]])(
    "clears the note to null for %s, rather than storing a blank one",
    async (_label, input) => {
      const { deps, putFeed } = makeDeps(makeFeed({ note: "an old note" }));

      const result = await setFeedNote(deps, FEED_ID, input);

      expect(result).toEqual({ status: "saved", note: null });
      expect(putFeed).toHaveBeenCalledWith(expect.objectContaining({ note: null }));
    },
  );

  it("preserves multi-line notes as written", async () => {
    const { deps, putFeed } = makeDeps(makeFeed());
    const multiline = "Why I follow this:\n- deep dives only\n- no breaking news";

    await setFeedNote(deps, FEED_ID, multiline);

    expect(putFeed).toHaveBeenCalledWith(expect.objectContaining({ note: multiline }));
  });

  it("changes ONLY the note, leaving fetch bookkeeping untouched", async () => {
    // The regression this guards: a screen handing back a whole `Feed` it was
    // holding would restore stale validators over what `refreshFeeds` wrote.
    const feed = makeFeed({
      etag: 'W/"abc"',
      lastModified: "Mon, 01 Jan 2024 10:00:00 GMT",
      lastFetchedAt: "2024-06-02T00:00:00.000Z",
      lastSuccessAt: "2024-06-02T00:00:00.000Z",
      lastError: { code: "FETCH_FAILED", at: "2024-06-01T00:00:00.000Z" },
      unstableGuid: 1,
    });
    const { deps, putFeed } = makeDeps(feed);

    await setFeedNote(deps, FEED_ID, "new note");

    expect(putFeed).toHaveBeenCalledWith({ ...feed, note: "new note" });
  });

  it("reports a feed that no longer exists instead of writing a new one", async () => {
    const { deps, putFeed } = makeDeps(undefined);

    expect(await setFeedNote(deps, FEED_ID, "note")).toEqual({ status: "not-found" });
    expect(putFeed).not.toHaveBeenCalled();
  });

  it("reports a failed write as a typed result rather than throwing", async () => {
    const { deps } = makeDeps(makeFeed(), vi.fn().mockRejectedValue(new Error("quota exceeded")));

    const result = await setFeedNote(deps, FEED_ID, "note");

    expect(result).toEqual({ status: "error", message: expect.stringContaining("quota exceeded") });
  });

  it("reports a failed read as a typed result too", async () => {
    const localStore = {
      getFeed: vi.fn().mockRejectedValue(new Error("database is closed")),
      putFeed: vi.fn(),
    } as unknown as LocalStorePort;

    const result = await setFeedNote({ localStore }, FEED_ID, "note");

    expect(result.status).toBe("error");
  });
});
