import { describe, expect, it, vi } from "vitest";
import type { ClockPort } from "../ports/ClockPort";
import type { Entry } from "../domain/models/Entry";
import { createEntry } from "../domain/models/Entry";
import type { LocalStorePort } from "../ports/LocalStorePort";
import { toggleEntryField, type FieldBinding } from "./toggleEntryField";

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

/**
 * The full behavioral matrix, written once and instantiated for both field
 * bindings -- the same shape as
 * `resolveField`'s property tests in design.md §4, which shrinks rather
 * than grows the test matrix. `toggleRead`
 * and `toggleStar` keep only thin per-field tests asserting the correct
 * field pair is bound; this file owns every shared case.
 */
const BINDINGS: readonly { readonly name: string; readonly binding: FieldBinding }[] = [
  { name: "read/readChangedAt", binding: { valueField: "read", timestampField: "readChangedAt" } },
  { name: "starred/starredChangedAt", binding: { valueField: "starred", timestampField: "starredChangedAt" } },
];

describe.each(BINDINGS)("toggleEntryField ($name)", ({ binding }) => {
  it("stamps the timestamp field when flipping the value 0 -> 1", async () => {
    const entry = makeEntry({ [binding.valueField]: 0, [binding.timestampField]: null });
    const localStore = makeLocalStore(entry);
    const clock = makeClock("2024-06-01T00:00:00.000Z");

    const result = await toggleEntryField({ localStore, clock }, entry.id, 1, binding);

    expect(result).toEqual({ status: "updated", value: 1, changedAt: "2024-06-01T00:00:00.000Z" });
    expect(localStore.putEntry).toHaveBeenCalledWith(
      expect.objectContaining({ [binding.valueField]: 1, [binding.timestampField]: "2024-06-01T00:00:00.000Z" }),
    );
  });

  it("stamps the timestamp field when flipping the value 1 -> 0", async () => {
    const entry = makeEntry({ [binding.valueField]: 1, [binding.timestampField]: "2024-01-01T00:00:00.000Z" });
    const localStore = makeLocalStore(entry);
    const clock = makeClock("2024-06-02T00:00:00.000Z");

    const result = await toggleEntryField({ localStore, clock }, entry.id, 0, binding);

    expect(result).toEqual({ status: "updated", value: 0, changedAt: "2024-06-02T00:00:00.000Z" });
    expect(localStore.putEntry).toHaveBeenCalledWith(
      expect.objectContaining({ [binding.valueField]: 0, [binding.timestampField]: "2024-06-02T00:00:00.000Z" }),
    );
  });

  it("does not advance the timestamp on a no-op toggle (already in the requested state)", async () => {
    const entry = makeEntry({ [binding.valueField]: 1, [binding.timestampField]: "2024-01-01T00:00:00.000Z" });
    const localStore = makeLocalStore(entry);
    const clock = makeClock("2024-06-01T00:00:00.000Z");

    const result = await toggleEntryField({ localStore, clock }, entry.id, 1, binding);

    expect(result).toEqual({ status: "no-op", value: 1 });
    expect(localStore.putEntry).not.toHaveBeenCalled();
  });

  it("returns not-found for an unknown entry id and never touches the clock or the store", async () => {
    const localStore = makeLocalStore(undefined);
    const clockNow = vi.fn().mockReturnValue(FIXED_NOW);

    const result = await toggleEntryField({ localStore, clock: { now: clockNow } }, "missing", 1, binding);

    expect(result).toEqual({ status: "not-found" });
    expect(clockNow).not.toHaveBeenCalled();
    expect(localStore.putEntry).not.toHaveBeenCalled();
  });

  it("surfaces a getEntry failure as a distinct error result instead of an unhandled rejection", async () => {
    const localStore = makeLocalStore(undefined, {
      getEntry: vi.fn().mockRejectedValue(new Error("IndexedDB connection lost")),
    });

    const result = await toggleEntryField({ localStore, clock: makeClock() }, "entry-1", 1, binding);

    expect(result).toEqual({ status: "error", message: "IndexedDB connection lost" });
    expect(localStore.putEntry).not.toHaveBeenCalled();
  });

  it("surfaces a putEntry failure as a distinct error result instead of an unhandled rejection", async () => {
    const entry = makeEntry({ [binding.valueField]: 0, [binding.timestampField]: null });
    const localStore = makeLocalStore(entry, {
      putEntry: vi.fn().mockRejectedValue(new Error("IndexedDB quota exceeded")),
    });

    const result = await toggleEntryField({ localStore, clock: makeClock() }, entry.id, 1, binding);

    expect(result).toEqual({ status: "error", message: "IndexedDB quota exceeded" });
  });
});
