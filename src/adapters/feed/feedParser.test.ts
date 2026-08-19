import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseFeedBody } from "./feedParser";

const FIXTURES_DIR = join(import.meta.dirname, "..", "..", "test", "fixtures", "feeds");

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), "utf8");
}

const FEED_ID = "https://example.com/feed.xml";
const FETCHED_AT = "2024-06-01T00:00:00.000Z";

describe("parseFeedBody", () => {
  it("parses RSS 2.0 into normalized entries", () => {
    const result = parseFeedBody({ body: readFixture("rss2.xml"), feedId: FEED_ID, fetchedAt: FETCHED_AT });

    expect(result.status).toBe("parsed");
    if (result.status !== "parsed") return;

    expect(result.feed.title).toBe("Example Blog");
    expect(result.feed.siteUrl).toBe("https://example.com");
    expect(result.feed.entries).toHaveLength(2);

    const [withGuid, withoutGuid] = result.feed.entries;
    expect(withGuid.title).toBe("Post One");
    expect(withGuid.link).toBe("https://example.com/post-1");
    expect(withGuid.guid).toBe("urn:uuid:abc-123");
    expect(withGuid.publishedAt).toBe(new Date("Mon, 01 Jan 2024 10:00:00 GMT").toISOString());
    expect(withGuid.summaryHtml).toBe("<p>Hello <b>world</b></p>");
    expect(withGuid.contentHtml).toBe("<p>Full <b>content</b> for post one.</p>");
    expect(withGuid.hasFullContent).toBe(1);
    expect(withGuid.feedId).toBe(FEED_ID);
    expect(withGuid.id).toMatch(new RegExp(`^${FEED_ID}:`));

    expect(withoutGuid.guid).toBeNull();
    expect(withoutGuid.contentHtml).toBeNull();
    expect(withoutGuid.hasFullContent).toBe(0);
  });

  it("parses RSS 1.0/RDF into normalized entries", () => {
    const result = parseFeedBody({ body: readFixture("rdf.xml"), feedId: FEED_ID, fetchedAt: FETCHED_AT });

    expect(result.status).toBe("parsed");
    if (result.status !== "parsed") return;

    expect(result.feed.title).toBe("RDF Blog");
    expect(result.feed.siteUrl).toBe("https://example.net/");
    expect(result.feed.entries).toHaveLength(1);
    const [entry] = result.feed.entries;
    expect(entry.title).toBe("RDF Post");
    expect(entry.link).toBe("https://example.net/post-1");
    expect(entry.contentHtml).toBe("<p>RDF full content.</p>");
  });

  it("parses Atom into normalized entries", () => {
    const result = parseFeedBody({ body: readFixture("atom.xml"), feedId: FEED_ID, fetchedAt: FETCHED_AT });

    expect(result.status).toBe("parsed");
    if (result.status !== "parsed") return;

    expect(result.feed.title).toBe("Atom Blog");
    expect(result.feed.siteUrl).toBe("https://example.org/");
    expect(result.feed.entries).toHaveLength(1);
    const [entry] = result.feed.entries;
    expect(entry.title).toBe("Atom Post");
    expect(entry.link).toBe("https://example.org/post-1");
    expect(entry.guid).toBeNull();
    expect(entry.publishedAt).toBe("2024-01-01T09:00:00.000Z");
    expect(entry.summaryHtml).toBe("A short summary");
    expect(entry.contentHtml).toBe("<p>Full <em>content</em></p>");
    expect(entry.hasFullContent).toBe(1);
  });

  it("parses JSON Feed into normalized entries", () => {
    const result = parseFeedBody({ body: readFixture("jsonfeed.json"), feedId: FEED_ID, fetchedAt: FETCHED_AT });

    expect(result.status).toBe("parsed");
    if (result.status !== "parsed") return;

    expect(result.feed.title).toBe("JSON Blog");
    expect(result.feed.siteUrl).toBe("https://example.io/");
    expect(result.feed.entries).toHaveLength(2);

    const [htmlPost, textPost] = result.feed.entries;
    expect(htmlPost.title).toBe("JSON Post");
    expect(htmlPost.contentHtml).toBe("<p>Full JSON content.</p>");
    expect(htmlPost.summaryHtml).toBe("A JSON summary");

    // content_text (no content_html) must be HTML-escaped before it is
    // stored in an *Html field, so a later render through SafeHtml renders
    // "<text>" as literal visible text instead of DOMPurify silently
    // stripping what looks like an unknown tag.
    expect(textPost.contentHtml).toBe("Just plain &lt;text&gt; with an angle bracket.");
  });

  it("derives a deterministic id when the entry supplies no guid/id", () => {
    const first = parseFeedBody({ body: readFixture("missing-guid.xml"), feedId: FEED_ID, fetchedAt: FETCHED_AT });
    const second = parseFeedBody({ body: readFixture("missing-guid.xml"), feedId: FEED_ID, fetchedAt: "2024-07-01T00:00:00.000Z" });

    expect(first.status).toBe("parsed");
    expect(second.status).toBe("parsed");
    if (first.status !== "parsed" || second.status !== "parsed") return;

    // Same feed, same underlying items, two different fetch runs: repeated
    // refreshes must not create duplicate entries for a guid-less item
    // (feed-fetching spec, "Entry without a stable id").
    expect(first.feed.entries.map((e) => e.id)).toEqual(second.feed.entries.map((e) => e.id));
    expect(new Set(first.feed.entries.map((e) => e.id)).size).toBe(2);
  });

  it("fails with a taxonomy error on malformed XML, never a throw", () => {
    expect(() =>
      parseFeedBody({ body: readFixture("malformed.xml"), feedId: FEED_ID, fetchedAt: FETCHED_AT }),
    ).not.toThrow();

    const result = parseFeedBody({ body: readFixture("malformed.xml"), feedId: FEED_ID, fetchedAt: FETCHED_AT });
    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(result.code).toBe("PARSE_FAILED");
    expect(result.message.length).toBeGreaterThan(0);
  });

  it("fails with a taxonomy error on content that is not any supported feed format, never a throw", () => {
    expect(() =>
      parseFeedBody({ body: "<html><body>not a feed</body></html>", feedId: FEED_ID, fetchedAt: FETCHED_AT }),
    ).not.toThrow();

    const result = parseFeedBody({ body: "<html><body>not a feed</body></html>", feedId: FEED_ID, fetchedAt: FETCHED_AT });
    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(result.code).toBe("PARSE_FAILED");
  });

  it("parses a feed whose declared XML encoding does not match the already-decoded JS string", () => {
    // fetch()/Response#text() always hands the parser an already UTF-16 JS
    // string; the <?xml encoding="..."?> declaration is metadata only at
    // that point and must not cause a parse failure.
    const result = parseFeedBody({ body: readFixture("wrong-charset.xml"), feedId: FEED_ID, fetchedAt: FETCHED_AT });
    expect(result.status).toBe("parsed");
    if (result.status !== "parsed") return;
    expect(result.feed.entries[0].title).toBe("Café Post");
  });
});
