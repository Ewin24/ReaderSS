import { describe, expect, it } from "vitest";
import { normalizeFeedUrl } from "./normalizeFeedUrl";

// design.md §3 "feeds — keyPath id": "id is the normalized feed URL (lowercased
// scheme+host, default port stripped, fragment stripped)". Also backs
// feed-subscriptions spec's "Duplicate subscriptions are prevented" scenario,
// which explicitly requires a URL differing only by trailing slash or the
// case of scheme/host to be treated as the same subscription identity.

describe("normalizeFeedUrl", () => {
  it("lowercases the scheme and host", () => {
    expect(normalizeFeedUrl("HTTPS://Example.COM/feed.xml")).toBe("https://example.com/feed.xml");
  });

  it("strips the default port for the scheme", () => {
    expect(normalizeFeedUrl("https://example.com:443/feed.xml")).toBe("https://example.com/feed.xml");
    expect(normalizeFeedUrl("http://example.com:80/feed.xml")).toBe("http://example.com/feed.xml");
  });

  it("keeps a non-default port", () => {
    expect(normalizeFeedUrl("https://example.com:8443/feed.xml")).toBe("https://example.com:8443/feed.xml");
  });

  it("strips the fragment", () => {
    expect(normalizeFeedUrl("https://example.com/feed.xml#section")).toBe("https://example.com/feed.xml");
  });

  it("strips a single trailing slash from a non-root path", () => {
    expect(normalizeFeedUrl("https://example.com/feed.xml/")).toBe("https://example.com/feed.xml");
  });

  it("keeps the root path as a single slash", () => {
    expect(normalizeFeedUrl("https://example.com/")).toBe("https://example.com/");
    expect(normalizeFeedUrl("https://example.com")).toBe("https://example.com/");
  });

  it("preserves the query string", () => {
    expect(normalizeFeedUrl("https://example.com/feed?format=rss")).toBe("https://example.com/feed?format=rss");
  });

  it("treats two URLs differing only by trailing slash and host case as identical", () => {
    expect(normalizeFeedUrl("HTTPS://EXAMPLE.com/feed.xml/")).toBe(normalizeFeedUrl("https://example.com/feed.xml"));
  });

  it("throws on a malformed URL", () => {
    expect(() => normalizeFeedUrl("not a url")).toThrow();
  });
});
