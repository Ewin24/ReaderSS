import { describe, expect, it } from "vitest";
import { createEntry } from "./Entry";
import { createEntryState, toEntryState } from "./EntryState";

describe("createEntryState", () => {
  it("defaults to unread and unstarred with null change timestamps", () => {
    const state = createEntryState({ entryId: "feed:abc123" });

    expect(state).toEqual({
      entryId: "feed:abc123",
      read: 0,
      readChangedAt: null,
      starred: 0,
      starredChangedAt: null,
    });
  });

  it("carries explicit read/starred values and their change timestamps", () => {
    const state = createEntryState({
      entryId: "feed:abc123",
      read: 1,
      readChangedAt: "2026-08-19T10:00:00.000Z",
      starred: 1,
      starredChangedAt: "2026-08-19T11:00:00.000Z",
    });

    expect(state).toEqual({
      entryId: "feed:abc123",
      read: 1,
      readChangedAt: "2026-08-19T10:00:00.000Z",
      starred: 1,
      starredChangedAt: "2026-08-19T11:00:00.000Z",
    });
  });
});

describe("toEntryState", () => {
  it("extracts only the sync-relevant fields from a full Entry", () => {
    const entry = createEntry({
      id: "feed:abc123",
      feedId: "https://example.com/feed.xml",
      contentHash: "hash-1",
      title: "Hello world",
      link: "https://example.com/hello",
      publishedAt: "2026-08-19T09:00:00.000Z",
      fetchedAt: "2026-08-19T10:00:00.000Z",
    });

    expect(toEntryState(entry)).toEqual({
      entryId: "feed:abc123",
      read: 0,
      readChangedAt: null,
      starred: 0,
      starredChangedAt: null,
    });
  });
});
