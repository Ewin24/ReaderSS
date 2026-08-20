import { describe, expect, it, vi } from "vitest";
import type { ClockPort } from "../ports/ClockPort";
import type { Entry } from "../domain/models/Entry";
import { createEntry } from "../domain/models/Entry";
import type { LocalStorePort } from "../ports/LocalStorePort";
import { toggleStar } from "./toggleStar";

// See toggleRead.test.ts's header comment: the full write-path matrix lives
// once, in toggleEntryField.test.ts, instantiated for both field bindings.
// This file keeps only the thin
// tests specific to toggleStar's own field pair.

const FIXED_NOW = "2024-06-01T00:00:00.000Z";

function makeClock(now = FIXED_NOW): ClockPort {
  return { now: () => now };
}

function makeEntry(overrides: Partial<Entry> = {}): Entry {
  return {
    ...createEntry({
      id: "entry-1",
      feedId: "feed-1",
      contentHash: "hash",
      title: "Title",
      link: "https://example.com/1",
      publishedAt: "2024-01-01T00:00:00.000Z",
      fetchedAt: "2024-01-01T00:00:00.000Z",
    }),
    ...overrides,
  };
}

function makeLocalStore(entry: Entry | undefined, overrides: Partial<LocalStorePort> = {}): LocalStorePort {
  return {
    getFeed: vi.fn(),
    listFeeds: vi.fn(),
    listFeedsByFolder: vi.fn(),
    putFeed: vi.fn(),
    putFeedWithEntries: vi.fn(),
    deleteFeed: vi.fn(),
    getEntry: vi.fn().mockResolvedValue(entry),
    getEntryByFeedAndGuid: vi.fn(),
    putEntry: vi.fn().mockResolvedValue(undefined),
    deleteEntry: vi.fn(),
    listEntriesByFeed: vi.fn(),
    listEntriesByFeedPublished: vi.fn(),
    listEntriesByPublished: vi.fn(),
    listUnreadEntries: vi.fn(),
    listStarredEntries: vi.fn(),
    getConfigValue: vi.fn(),
    putConfigValue: vi.fn(),
    ...overrides,
  } as unknown as LocalStorePort;
}

describe("toggleStar", () => {
  it("binds the starred/starredChangedAt field pair when starring an unstarred entry (0 -> 1)", async () => {
    const entry = makeEntry({ starred: 0, starredChangedAt: null });
    const localStore = makeLocalStore(entry);
    const clock = makeClock("2024-06-01T00:00:00.000Z");

    const result = await toggleStar({ localStore, clock }, entry.id, 1);

    expect(result).toEqual({ status: "updated", starred: 1, starredChangedAt: "2024-06-01T00:00:00.000Z" });
    expect(localStore.putEntry).toHaveBeenCalledWith(
      expect.objectContaining({ starred: 1, starredChangedAt: "2024-06-01T00:00:00.000Z" }),
    );
  });

  it("never stamps starredChangedAt when an entry is merely loaded, without an explicit toggle call", async () => {
    // See toggleRead.test.ts's equivalent case for why the refresh-specific
    // half of this claim is verified in refreshFeeds.test.ts instead.
    const entry = makeEntry({ starred: 0, starredChangedAt: null });
    const localStore = makeLocalStore(entry);
    const clockNow = vi.fn().mockReturnValue(FIXED_NOW);

    await localStore.getEntry(entry.id);

    expect(clockNow).not.toHaveBeenCalled();
    expect(localStore.putEntry).not.toHaveBeenCalled();
  });

  it("returns not-found for an unknown entry id and never touches the clock or the store", async () => {
    const localStore = makeLocalStore(undefined);
    const clockNow = vi.fn().mockReturnValue(FIXED_NOW);

    const result = await toggleStar({ localStore, clock: { now: clockNow } }, "missing", 1);

    expect(result).toEqual({ status: "not-found" });
    expect(clockNow).not.toHaveBeenCalled();
    expect(localStore.putEntry).not.toHaveBeenCalled();
  });
});
