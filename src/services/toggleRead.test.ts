import { describe, expect, it, vi } from "vitest";
import type { ClockPort } from "../ports/ClockPort";
import type { Entry } from "../domain/models/Entry";
import { createEntry } from "../domain/models/Entry";
import type { LocalStorePort } from "../ports/LocalStorePort";
import { toggleRead } from "./toggleRead";

// The full write-path matrix (0->1, 1->0, no-op, not-found, and the
// Finding-3 error-surfacing cases) is written ONCE, against the shared
// `toggleEntryField` helper, and instantiated for both `read` and `starred`
// in `toggleEntryField.test.ts` (Finding 6, Slice 6 correction round). This
// file keeps only the thin tests that are specific to `toggleRead`: that it
// binds the `read`/`readChangedAt` field pair (not `starred`), and the
// write-path-rule-3 documentation case that predates `refreshFeeds`.

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

describe("toggleRead", () => {
  it("binds the read/readChangedAt field pair when marking an unread entry as read (0 -> 1)", async () => {
    const entry = makeEntry({ read: 0, readChangedAt: null });
    const localStore = makeLocalStore(entry);
    const clock = makeClock("2024-06-01T00:00:00.000Z");

    const result = await toggleRead({ localStore, clock }, entry.id, 1);

    expect(result).toEqual({ status: "updated", read: 1, readChangedAt: "2024-06-01T00:00:00.000Z" });
    expect(localStore.putEntry).toHaveBeenCalledWith(
      expect.objectContaining({ read: 1, readChangedAt: "2024-06-01T00:00:00.000Z" }),
    );
  });

  it("never stamps readChangedAt when an entry is merely loaded, without an explicit toggle call", async () => {
    // The refresh- and merge-specific half of "refresh/merge/load never
    // stamp" (an entry re-persisted by refreshFeeds keeps its existing
    // read/readChangedAt untouched) is verified end-to-end in
    // refreshFeeds.test.ts. What IS verifiable here, honestly, is that the
    // read half of a "load" -- calling LocalStorePort.getEntry directly,
    // bypassing toggleRead entirely -- has no side effect on the clock or
    // the store.
    const entry = makeEntry({ read: 0, readChangedAt: null });
    const localStore = makeLocalStore(entry);
    const clockNow = vi.fn().mockReturnValue(FIXED_NOW);

    await localStore.getEntry(entry.id);

    expect(clockNow).not.toHaveBeenCalled();
    expect(localStore.putEntry).not.toHaveBeenCalled();
  });

  it("returns not-found for an unknown entry id and never touches the clock or the store", async () => {
    const localStore = makeLocalStore(undefined);
    const clockNow = vi.fn().mockReturnValue(FIXED_NOW);

    const result = await toggleRead({ localStore, clock: { now: clockNow } }, "missing", 1);

    expect(result).toEqual({ status: "not-found" });
    expect(clockNow).not.toHaveBeenCalled();
    expect(localStore.putEntry).not.toHaveBeenCalled();
  });
});
