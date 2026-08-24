import { describe, expect, it } from "vitest";
import { createFeed } from "./Feed";

describe("createFeed", () => {
  it("builds a feed record with the required identity fields and safe defaults", () => {
    const feed = createFeed({
      id: "https://example.com/feed.xml",
      url: "https://example.com/feed.xml",
      normalizedUrl: "https://example.com/feed.xml",
      title: "Example Feed",
      siteUrl: "https://example.com",
      folder: "News",
      addedAt: "2026-08-19T10:00:00.000Z",
    });

    expect(feed).toEqual({
      id: "https://example.com/feed.xml",
      url: "https://example.com/feed.xml",
      normalizedUrl: "https://example.com/feed.xml",
      title: "Example Feed",
      siteUrl: "https://example.com",
      folder: "News",
      etag: null,
      lastModified: null,
      lastFetchedAt: null,
      lastSuccessAt: null,
      lastError: null,
      addedAt: "2026-08-19T10:00:00.000Z",
      unstableGuid: 0,
      note: null,
    });
  });

  it("defaults siteUrl and folder to null when omitted", () => {
    const feed = createFeed({
      id: "https://other.example/feed.xml",
      url: "https://other.example/feed.xml",
      normalizedUrl: "https://other.example/feed.xml",
      title: "Other Feed",
      addedAt: "2026-08-19T11:00:00.000Z",
    });

    expect(feed.siteUrl).toBeNull();
    expect(feed.folder).toBeNull();
    expect(feed.unstableGuid).toBe(0);
  });
});
