/// <reference types="node" />
/**
 * Adapter-level tests: they run the REAL feedsmith, because the whole point
 * of this module is the boundary with it -- what it returns for a real
 * document, and what it does when handed junk. The meaning of the parsed tree
 * is `domain/opml/opmlSubscriptions.test.ts`'s job, not this file's.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { feedsmithOpmlCodec } from "./feedsmithOpmlCodec";
import { flattenOpmlOutlines } from "../../domain/opml/opmlSubscriptions";

const FIXED_NOW = "2024-06-01T00:00:00.000Z";

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>My subscriptions</title></head>
  <body>
    <outline text="Tech">
      <outline type="rss" text="Ars" title="Ars Technica" xmlUrl="https://arstechnica.com/feed/" htmlUrl="https://arstechnica.com"/>
      <outline type="rss" text="HN" xmlUrl="https://news.ycombinator.com/rss"/>
    </outline>
    <outline type="rss" text="Solo" xmlUrl="https://example.com/feed.xml"/>
    <outline text="Just a label"/>
  </body>
</opml>`;

describe("feedsmithOpmlCodec.parse", () => {
  it("parses a real OPML document into the domain's outline shape", () => {
    const result = feedsmithOpmlCodec.parse(SAMPLE);

    expect(result.status).toBe("parsed");
    if (result.status !== "parsed") return;
    expect(result.title).toBe("My subscriptions");
    expect(result.outlines).toHaveLength(3);
  });

  it("produces outlines the domain flattener reads correctly end to end", () => {
    const result = feedsmithOpmlCodec.parse(SAMPLE);
    if (result.status !== "parsed") throw new Error("expected a parsed document");

    expect(flattenOpmlOutlines(result.outlines)).toEqual([
      { url: "https://arstechnica.com/feed/", title: "Ars Technica", folder: "Tech", note: null },
      { url: "https://news.ycombinator.com/rss", title: "HN", folder: "Tech", note: null },
      { url: "https://example.com/feed.xml", title: "Solo", folder: null, note: null },
    ]);
  });

  it.each([
    ["an empty string", ""],
    ["plain text", "not xml at all"],
    ["an HTML document", "<html><body>hi</body></html>"],
  ])("returns an invalid result rather than throwing for %s", (_label, input) => {
    const result = feedsmithOpmlCodec.parse(input);

    expect(result.status).toBe("invalid");
    if (result.status !== "invalid") return;
    expect(result.message.length).toBeGreaterThan(0);
  });
});

describe("feedsmithOpmlCodec.serialize", () => {
  it("writes feeds grouped into their folders, un-foldered ones at the top level", () => {
    const xml = feedsmithOpmlCodec.serialize({
      title: "ReaderSS subscriptions",
      createdAt: FIXED_NOW,
      feeds: [
        { url: "https://arstechnica.com/feed/", title: "Ars Technica", folder: "Tech", note: null, siteUrl: null },
        { url: "https://example.com/feed.xml", title: "Solo", folder: null, note: null, siteUrl: null },
        { url: "https://news.ycombinator.com/rss", title: "HN", folder: "Tech", note: null, siteUrl: null },
      ],
    });

    expect(xml).toContain("<title>ReaderSS subscriptions</title>");
    expect(xml).toContain('text="Tech"');
    expect(xml).toContain('xmlUrl="https://arstechnica.com/feed/"');
    expect(xml).toContain('xmlUrl="https://news.ycombinator.com/rss"');
    expect(xml).toContain('xmlUrl="https://example.com/feed.xml"');
  });

  it("round-trips: what it writes, it can read back unchanged", () => {
    const feeds = [
      { url: "https://arstechnica.com/feed/", title: "Ars Technica", folder: "Tech", note: null, siteUrl: null },
      { url: "https://news.ycombinator.com/rss", title: "HN", folder: "Tech", note: null, siteUrl: null },
      { url: "https://example.com/feed.xml", title: "Solo", folder: null, note: null, siteUrl: null },
    ];

    const xml = feedsmithOpmlCodec.serialize({ title: "ReaderSS subscriptions", createdAt: FIXED_NOW, feeds });
    const parsed = feedsmithOpmlCodec.parse(xml);
    if (parsed.status !== "parsed") throw new Error("round-trip produced an unreadable document");

    // `siteUrl` is export-only input (it becomes `htmlUrl`); the import side
    // does not read it back, so the round trip is compared on the shared fields.
    expect(flattenOpmlOutlines(parsed.outlines)).toEqual(
      feeds.map((feed) => ({
        url: feed.url,
        title: feed.title,
        folder: feed.folder,
        note: feed.note,
      })),
    );
  });

  it("falls back to the URL as the outline text when a feed has no title", () => {
    const xml = feedsmithOpmlCodec.serialize({
      title: "ReaderSS subscriptions",
      createdAt: FIXED_NOW,
      feeds: [{ url: "https://example.com/feed.xml", title: null, folder: null, note: null, siteUrl: null }],
    });

    expect(xml).toContain('text="https://example.com/feed.xml"');
  });

  it("writes a valid, readable document even with no feeds at all", () => {
    const xml = feedsmithOpmlCodec.serialize({ title: "ReaderSS subscriptions", feeds: [], createdAt: FIXED_NOW });
    const parsed = feedsmithOpmlCodec.parse(xml);

    expect(parsed.status).toBe("parsed");
    if (parsed.status !== "parsed") return;
    expect(flattenOpmlOutlines(parsed.outlines)).toEqual([]);
  });
});

describe("feedsmithOpmlCodec — feed notes", () => {
  it("writes a note as the standard description attribute and reads it back", () => {
    const feeds = [
      {
        url: "https://arstechnica.com/feed/",
        title: "Ars Technica",
        folder: "Tech",
        note: "Long-form only. Skip the deal posts.",
        siteUrl: null,
      },
    ];

    const xml = feedsmithOpmlCodec.serialize({ title: "ReaderSS subscriptions", createdAt: FIXED_NOW, feeds });
    expect(xml).toContain('description="Long-form only. Skip the deal posts."');

    const parsed = feedsmithOpmlCodec.parse(xml);
    if (parsed.status !== "parsed") throw new Error("round-trip produced an unreadable document");
    // `siteUrl` is export-only input (it becomes `htmlUrl`); the import side
    // does not read it back, so the round trip is compared on the shared fields.
    expect(flattenOpmlOutlines(parsed.outlines)).toEqual(
      feeds.map((feed) => ({
        url: feed.url,
        title: feed.title,
        folder: feed.folder,
        note: feed.note,
      })),
    );
  });

  it("omits the attribute entirely when there is no note", () => {
    const xml = feedsmithOpmlCodec.serialize({
      title: "ReaderSS subscriptions",
      createdAt: FIXED_NOW,
      feeds: [{ url: "https://example.com/f.xml", title: "No note", folder: null, note: null, siteUrl: null }],
    });

    // `description=""` would read as "a description that is blank", which is
    // a different claim from "no description".
    expect(xml).not.toContain("description=");
  });

  it("escapes a note containing XML metacharacters, and survives the round trip", () => {
    const note = 'Covers "AT&T" <policy> stuff';
    const xml = feedsmithOpmlCodec.serialize({
      title: "ReaderSS subscriptions",
      createdAt: FIXED_NOW,
      feeds: [{ url: "https://example.com/f.xml", title: "T", folder: null, note, siteUrl: null }],
    });

    const parsed = feedsmithOpmlCodec.parse(xml);
    if (parsed.status !== "parsed") throw new Error("unreadable after escaping");
    expect(flattenOpmlOutlines(parsed.outlines)[0].note).toBe(note);
  });

  it("reads a description written by another reader", () => {
    const foreign = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0"><head><title>Theirs</title></head><body>
<outline type="rss" text="Theirs" xmlUrl="https://theirs.example.com/feed.xml"
  description="Their own words about this feed."/>
</body></opml>`;

    const parsed = feedsmithOpmlCodec.parse(foreign);
    if (parsed.status !== "parsed") throw new Error("expected a parsed document");
    expect(flattenOpmlOutlines(parsed.outlines)[0].note).toBe("Their own words about this feed.");
  });

  it("DROPS a <description> child element, which is not what OPML 2.0 defines", () => {
    // Documented limitation, not an oversight. Some exporters (Scour among
    // them) write a `<description>` CHILD ELEMENT instead of the spec's
    // attribute, and feedsmith does not surface it. Asserted here so the gap
    // is visible and provable rather than discovered later by a user whose
    // notes silently vanished on import.
    const childElementForm = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0"><head><title>Theirs</title></head><body>
<outline text="Folder" title="Folder">
  <description>A folder-level note in the non-standard child-element form.</description>
  <outline type="rss" text="Feed" xmlUrl="https://theirs.example.com/feed.xml"/>
</outline>
</body></opml>`;

    const parsed = feedsmithOpmlCodec.parse(childElementForm);
    if (parsed.status !== "parsed") throw new Error("expected a parsed document");
    expect(parsed.outlines[0].description).toBeNull();
    expect(flattenOpmlOutlines(parsed.outlines)[0].note).toBeNull();
  });
});

/**
 * The exported document has to look like what feed readers actually produce,
 * not merely like something this codec can read back. OPML 2.0 lists
 * `type`, `text` and `xmlUrl` as REQUIRED on a subscription outline, and real
 * exporters write `title` alongside `text`; an earlier version wrote only
 * `text` + `xmlUrl`, which round-tripped here while being a document another
 * reader could legitimately reject.
 */
describe("feedsmithOpmlCodec.serialize — the shape other readers expect", () => {
  const feed = {
    url: "https://loadingartist.com/index.xml",
    title: "Loading Artist",
    folder: "Comics",
    note: null,
    siteUrl: "https://loadingartist.com",
  };

  function exported() {
    return feedsmithOpmlCodec.serialize({
      title: "ReaderSS subscriptions",
      createdAt: FIXED_NOW,
      feeds: [feed],
    });
  }

  it('writes type="rss" on every subscription outline', () => {
    expect(exported()).toContain('type="rss"');
  });

  it("writes both text and title, as real exporters do", () => {
    const xml = exported();

    expect(xml).toContain('text="Loading Artist"');
    expect(xml).toContain('title="Loading Artist"');
  });

  it("writes the site as htmlUrl when it is known, and omits it otherwise", () => {
    expect(exported()).toContain('htmlUrl="https://loadingartist.com"');

    const withoutSite = feedsmithOpmlCodec.serialize({
      title: "ReaderSS subscriptions",
      createdAt: FIXED_NOW,
      feeds: [{ ...feed, siteUrl: null }],
    });
    expect(withoutSite).not.toContain("htmlUrl=");
  });

  it("stamps the head with when it was written and a pointer to the spec", () => {
    const xml = exported();

    expect(xml).toContain("<dateCreated>");
    expect(xml).toContain("<dateModified>");
    expect(xml).toContain("<docs>http://opml.org/spec2.opml</docs>");
  });

  it("takes the timestamp from its input, never from the system clock", () => {
    // Determinism: two exports of the same input are byte-identical.
    expect(exported()).toBe(exported());
    expect(exported()).toContain("2024");
  });

  it("gives the empty document the same head as a populated one", () => {
    const empty = feedsmithOpmlCodec.serialize({
      title: "ReaderSS subscriptions",
      createdAt: FIXED_NOW,
      feeds: [],
    });

    expect(empty).toContain("<dateCreated>");
    expect(empty).toContain("<docs>http://opml.org/spec2.opml</docs>");
    expect(feedsmithOpmlCodec.parse(empty).status).toBe("parsed");
  });

  it("nests feeds under their folder outline, matching the common layout", () => {
    const xml = exported();
    const folderAt = xml.indexOf('text="Comics"');
    const feedAt = xml.indexOf('xmlUrl="https://loadingartist.com/index.xml"');

    expect(folderAt).toBeGreaterThan(-1);
    expect(feedAt).toBeGreaterThan(folderAt);
  });
});

/**
 * A real feed reader's export, kept verbatim as a fixture
 * (`src/test/fixtures/opml/reader-export.opml`) rather than hand-written
 * inline: it carries the details a synthetic sample tends to leave out --
 * tab indentation, `&apos;`/`&amp;` entities in titles and folder names,
 * a `title` that differs from its `text`, and a `<head>` with dates and
 * `<docs>`.
 */
describe("importing a real reader export", () => {
  const xml = readFileSync(
    join(import.meta.dirname, "..", "..", "test", "fixtures", "opml", "reader-export.opml"),
    "utf8",
  );

  it("reads every feed with its folder, decoding XML entities", () => {
    const parsed = feedsmithOpmlCodec.parse(xml);
    if (parsed.status !== "parsed") throw new Error("a real reader export failed to parse");

    expect(parsed.title).toBe("Kevin Cox's Favourite Feeds");
    expect(flattenOpmlOutlines(parsed.outlines)).toEqual([
      {
        url: "https://loadingartist.com/index.xml",
        title: "Loading Artist",
        folder: "Comics",
        note: null,
      },
      {
        // `&apos;` decoded, not left as an entity.
        url: "https://sarahcandersen.com/rss",
        title: "Sarah's Scribbles",
        folder: "Comics",
        note: null,
      },
      {
        // `&amp;` in the FOLDER name decoded too.
        url: "https://aphyr.com/posts.atom",
        title: "Aphyr: Posts",
        folder: "News & Blogs",
        note: null,
      },
      {
        // `title` differs from `text` here; `title` wins.
        url: "https://words.filippo.io/rss/",
        title: "Cryptography Dispatches",
        folder: "News & Blogs",
        note: null,
      },
    ]);
  });

  it("re-exports into a document that reads back identically", () => {
    const parsed = feedsmithOpmlCodec.parse(xml);
    if (parsed.status !== "parsed") throw new Error("a real reader export failed to parse");
    const imported = flattenOpmlOutlines(parsed.outlines);

    const reExported = feedsmithOpmlCodec.serialize({
      title: "ReaderSS subscriptions",
      createdAt: FIXED_NOW,
      feeds: imported.map((sub) => ({ ...sub, siteUrl: null })),
    });

    const reParsed = feedsmithOpmlCodec.parse(reExported);
    if (reParsed.status !== "parsed") throw new Error("our own export was not readable");
    expect(flattenOpmlOutlines(reParsed.outlines)).toEqual(imported);
  });
});
