import { describe, expect, it } from "vitest";
import { deriveEntryIdentity, detectsUnstableGuid } from "./entryIdentity";

const FEED_ID = "https://example.com/feed.xml";
const OTHER_FEED_ID = "https://other.example/feed.xml";

describe("deriveEntryIdentity", () => {
  it("derives the same identity for the same guid on the same feed", () => {
    const first = deriveEntryIdentity({ feedId: FEED_ID, guid: "guid-1" });
    const second = deriveEntryIdentity({ feedId: FEED_ID, guid: "guid-1" });

    expect(first).toBe(second);
    expect(first.startsWith(`${FEED_ID}:`)).toBe(true);
  });

  it("scopes identity by feed: the same guid on two feeds derives two different ids", () => {
    const onFeedA = deriveEntryIdentity({ feedId: FEED_ID, guid: "shared-guid" });
    const onFeedB = deriveEntryIdentity({ feedId: OTHER_FEED_ID, guid: "shared-guid" });

    expect(onFeedA).not.toBe(onFeedB);
  });

  it("falls back to id when guid is absent", () => {
    const withGuid = deriveEntryIdentity({ feedId: FEED_ID, guid: "x", id: "x" });
    const withId = deriveEntryIdentity({ feedId: FEED_ID, id: "x" });

    expect(withGuid).toBe(withId);
  });

  it("falls back to link when guid and id are absent", () => {
    const withLink = deriveEntryIdentity({
      feedId: FEED_ID,
      link: "https://example.com/article-1",
    });
    const sameLinkAgain = deriveEntryIdentity({
      feedId: FEED_ID,
      link: "https://example.com/article-1",
    });

    expect(withLink).toBe(sameLinkAgain);
  });

  it("falls back to link + publishedAt + title when no guid/id/link identity is available", () => {
    const first = deriveEntryIdentity({
      feedId: FEED_ID,
      publishedAt: "2026-08-19T09:00:00.000Z",
      title: "Untitled post",
    });
    const differentTitle = deriveEntryIdentity({
      feedId: FEED_ID,
      publishedAt: "2026-08-19T09:00:00.000Z",
      title: "A different post",
    });

    expect(first).not.toBe(differentTitle);
  });
});

describe("detectsUnstableGuid", () => {
  it("returns false when the feed has no prior baseline", () => {
    expect(detectsUnstableGuid([], ["a:new1", "a:new2"], 2)).toBe(false);
  });

  it("returns false when at least one previous id survives into the new payload", () => {
    const previousIds = ["a:1", "a:2", "a:3"];
    const incomingIds = ["a:1", "a:4", "a:5"];

    expect(detectsUnstableGuid(previousIds, incomingIds, 3)).toBe(false);
  });

  it("returns true when none of the previous ids survive and every incoming id is unique", () => {
    const previousIds = ["a:1", "a:2", "a:3"];
    const incomingIds = ["a:9", "a:10", "a:11"];

    expect(detectsUnstableGuid(previousIds, incomingIds, 3)).toBe(true);
  });

  it("returns false when incoming ids collide internally (unique count below item count)", () => {
    const previousIds = ["a:1"];
    const incomingIds = ["a:9", "a:9", "a:10"];

    expect(detectsUnstableGuid(previousIds, incomingIds, 3)).toBe(false);
  });
});
