import { describe, expect, it } from "vitest";
import { createEntry } from "./Entry";

describe("createEntry", () => {
  it("builds a new entry as unread and unstarred with null change timestamps", () => {
    const entry = createEntry({
      id: "feed:abc123",
      feedId: "https://example.com/feed.xml",
      guid: "guid-1",
      contentHash: "hash-1",
      title: "Hello world",
      link: "https://example.com/hello",
      author: "Jane Doe",
      publishedAt: "2026-08-19T09:00:00.000Z",
      fetchedAt: "2026-08-19T10:00:00.000Z",
      summaryHtml: "<p>Hi</p>",
      contentHtml: null,
      hasFullContent: 0,
    });

    expect(entry).toEqual({
      id: "feed:abc123",
      feedId: "https://example.com/feed.xml",
      guid: "guid-1",
      contentHash: "hash-1",
      title: "Hello world",
      link: "https://example.com/hello",
      author: "Jane Doe",
      publishedAt: "2026-08-19T09:00:00.000Z",
      fetchedAt: "2026-08-19T10:00:00.000Z",
      summaryHtml: "<p>Hi</p>",
      contentHtml: null,
      hasFullContent: 0,
      read: 0,
      readChangedAt: null,
      starred: 0,
      starredChangedAt: null,
      updatedAt: "2026-08-19T10:00:00.000Z",
    });
  });

  it("defaults optional identity and content fields to null when omitted", () => {
    const entry = createEntry({
      id: "feed:def456",
      feedId: "https://example.com/feed.xml",
      contentHash: "hash-2",
      title: "No guid",
      link: "https://example.com/no-guid",
      publishedAt: "2026-08-19T09:30:00.000Z",
      fetchedAt: "2026-08-19T10:30:00.000Z",
    });

    expect(entry.guid).toBeNull();
    expect(entry.author).toBeNull();
    expect(entry.summaryHtml).toBeNull();
    expect(entry.contentHtml).toBeNull();
    expect(entry.hasFullContent).toBe(0);
    expect(entry.read).toBe(0);
    expect(entry.readChangedAt).toBeNull();
    expect(entry.starred).toBe(0);
    expect(entry.starredChangedAt).toBeNull();
  });
});
