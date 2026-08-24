/**
 * An OPML file is another program's export, so the tests below are mostly
 * about what the flattener REFUSES to choke on: missing attributes, folders
 * with no feeds, feeds with no folder, junk URLs, and the same feed listed
 * twice. Real exports contain all of these.
 */
import { describe, expect, it } from "vitest";
import { flattenOpmlOutlines, type OpmlOutlineNode } from "./opmlSubscriptions";

describe("flattenOpmlOutlines", () => {
  it("returns nothing for an absent or empty tree", () => {
    expect(flattenOpmlOutlines(undefined)).toEqual([]);
    expect(flattenOpmlOutlines([])).toEqual([]);
  });

  it("reads a flat list of feeds, preferring title over text", () => {
    const nodes: OpmlOutlineNode[] = [
      { text: "Ars", title: "Ars Technica", xmlUrl: "https://arstechnica.com/feed/" },
      { text: "HN", xmlUrl: "https://news.ycombinator.com/rss" },
    ];

    expect(flattenOpmlOutlines(nodes)).toEqual([
      { url: "https://arstechnica.com/feed/", title: "Ars Technica", folder: null, note: null },
      { url: "https://news.ycombinator.com/rss", title: "HN", folder: null, note: null },
    ]);
  });

  it("assigns the enclosing folder name to nested feeds", () => {
    const nodes: OpmlOutlineNode[] = [
      {
        text: "Tech",
        outlines: [{ text: "Ars", xmlUrl: "https://arstechnica.com/feed/" }],
      },
      { text: "Loose", xmlUrl: "https://example.com/loose.xml" },
    ];

    expect(flattenOpmlOutlines(nodes)).toEqual([
      { url: "https://arstechnica.com/feed/", title: "Ars", folder: "Tech", note: null },
      { url: "https://example.com/loose.xml", title: "Loose", folder: null, note: null },
    ]);
  });

  it("uses the NEAREST folder when folders are nested deeper than one level", () => {
    const nodes: OpmlOutlineNode[] = [
      {
        text: "Tech",
        outlines: [
          {
            text: "Security",
            outlines: [{ text: "Krebs", xmlUrl: "https://krebsonsecurity.com/feed/" }],
          },
        ],
      },
    ];

    expect(flattenOpmlOutlines(nodes)).toEqual([
      { url: "https://krebsonsecurity.com/feed/", title: "Krebs", folder: "Security", note: null },
    ]);
  });

  it("treats a node that is both a feed and a container as both", () => {
    const nodes: OpmlOutlineNode[] = [
      {
        text: "Parent",
        xmlUrl: "https://example.com/parent.xml",
        outlines: [{ text: "Child", xmlUrl: "https://example.com/child.xml" }],
      },
    ];

    expect(flattenOpmlOutlines(nodes)).toEqual([
      { url: "https://example.com/parent.xml", title: "Parent", folder: null, note: null },
      { url: "https://example.com/child.xml", title: "Child", folder: "Parent", note: null },
    ]);
  });

  it("skips folders that contain no feeds, and nodes that are neither", () => {
    const nodes: OpmlOutlineNode[] = [
      { text: "Empty folder", outlines: [] },
      { text: "Just a label" },
      {},
    ];

    expect(flattenOpmlOutlines(nodes)).toEqual([]);
  });

  it("skips URLs that are not safe absolute http(s) URLs", () => {
    const nodes: OpmlOutlineNode[] = [
      { text: "Script", xmlUrl: "javascript:alert(1)" },
      { text: "Relative", xmlUrl: "/feed.xml" },
      { text: "Data", xmlUrl: "data:text/xml,<rss/>" },
      { text: "Blank", xmlUrl: "   " },
      { text: "Good", xmlUrl: "https://example.com/feed.xml" },
    ];

    expect(flattenOpmlOutlines(nodes)).toEqual([
      { url: "https://example.com/feed.xml", title: "Good", folder: null, note: null },
    ]);
  });

  it("keeps the first occurrence when the same feed appears twice", () => {
    // Same feed, written three ways that normalize to one identity.
    const nodes: OpmlOutlineNode[] = [
      { text: "First", xmlUrl: "https://example.com/feed" },
      { text: "Trailing slash", xmlUrl: "https://example.com/feed/" },
      { text: "Host case", xmlUrl: "https://EXAMPLE.com/feed" },
    ];

    expect(flattenOpmlOutlines(nodes)).toEqual([
      { url: "https://example.com/feed", title: "First", folder: null, note: null },
    ]);
  });

  it("normalizes blank titles and folder names to null rather than empty strings", () => {
    const nodes: OpmlOutlineNode[] = [
      { text: "   ", outlines: [{ text: "  ", xmlUrl: "https://example.com/feed.xml" }] },
    ];

    expect(flattenOpmlOutlines(nodes)).toEqual([
      { url: "https://example.com/feed.xml", title: null, folder: null, note: null },
    ]);
  });

  it("preserves the URL verbatim, not its normalized identity form", () => {
    const nodes: OpmlOutlineNode[] = [
      { text: "Odd", xmlUrl: "https://EXAMPLE.com/Feed/?x=1" },
    ];

    // Normalization is a comparison key; what gets fetched is what was written.
    expect(flattenOpmlOutlines(nodes)[0].url).toBe("https://EXAMPLE.com/Feed/?x=1");
  });
});

/**
 * A feed's note travels as OPML 2.0's `description` attribute. The tests below
 * pin the two decisions that are easy to get wrong: blank descriptions become
 * `null` rather than empty strings, and a FOLDER's description is not copied
 * onto the feeds inside it.
 */
describe("flattenOpmlOutlines — feed notes", () => {
  it("reads a feed's description as its note", () => {
    const nodes: OpmlOutlineNode[] = [
      {
        text: "Ars",
        xmlUrl: "https://arstechnica.com/feed/",
        description: "Long-form only. Skip the deal posts.",
      },
    ];

    expect(flattenOpmlOutlines(nodes)[0].note).toBe("Long-form only. Skip the deal posts.");
  });

  it("preserves a multi-line description as written", () => {
    const note = "Why I follow this:\n- deep dives\n- no breaking news";
    const nodes: OpmlOutlineNode[] = [
      { text: "Ars", xmlUrl: "https://arstechnica.com/feed/", description: note },
    ];

    expect(flattenOpmlOutlines(nodes)[0].note).toBe(note);
  });

  it("treats a blank or absent description as no note", () => {
    const nodes: OpmlOutlineNode[] = [
      { text: "Blank", xmlUrl: "https://a.example.com/f.xml", description: "   " },
      { text: "Absent", xmlUrl: "https://b.example.com/f.xml" },
    ];

    expect(flattenOpmlOutlines(nodes).map((s) => s.note)).toEqual([null, null]);
  });

  it("does NOT copy a folder's description onto the feeds inside it", () => {
    // A folder description describes the FOLDER. Pushing one paragraph onto
    // each of its feeds would assert something the file never said about them.
    const nodes: OpmlOutlineNode[] = [
      {
        text: "Current affairs",
        description: "I want significant events, not gossip or speculation.",
        outlines: [
          { text: "BBC News", xmlUrl: "https://feeds.bbci.co.uk/news/rss.xml" },
          {
            text: "POLITICO",
            xmlUrl: "https://www.politico.eu/feed/",
            description: "EU policy specifically.",
          },
        ],
      },
    ];

    expect(flattenOpmlOutlines(nodes)).toEqual([
      {
        url: "https://feeds.bbci.co.uk/news/rss.xml",
        title: "BBC News",
        folder: "Current affairs",
        note: null,
      },
      {
        url: "https://www.politico.eu/feed/",
        title: "POLITICO",
        folder: "Current affairs",
        note: "EU policy specifically.",
      },
    ]);
  });

  it("keeps the FIRST occurrence's note when a feed is listed twice", () => {
    const nodes: OpmlOutlineNode[] = [
      { text: "One", xmlUrl: "https://example.com/feed", description: "kept" },
      { text: "One again", xmlUrl: "https://example.com/feed/", description: "discarded" },
    ];

    expect(flattenOpmlOutlines(nodes)).toEqual([
      { url: "https://example.com/feed", title: "One", folder: null, note: "kept" },
    ]);
  });
});

/**
 * OPML 2.0's `category` attribute is the only grouping the SPECIFICATION
 * actually defines -- folders-by-nesting are a convention the spec itself
 * warns "some processors may not understand and preserve". Files that group
 * only with `category` used to import with no folders at all.
 */
describe("flattenOpmlOutlines — the category attribute", () => {
  it("uses the last segment of a slash-delimited category as the folder", () => {
    const nodes: OpmlOutlineNode[] = [
      { text: "A", xmlUrl: "https://a.example.com/f.xml", category: "/Tech/Security" },
    ];

    // Same "nearest wins" rule nesting uses, so a feed grouped either way
    // lands in the same folder.
    expect(flattenOpmlOutlines(nodes)[0].folder).toBe("Security");
  });

  it("takes the first path when several comma-separated categories are listed", () => {
    const nodes: OpmlOutlineNode[] = [
      { text: "A", xmlUrl: "https://a.example.com/f.xml", category: "/Tech/Security,/Reading" },
    ];

    expect(flattenOpmlOutlines(nodes)[0].folder).toBe("Security");
  });

  it("accepts a category with no slashes at all", () => {
    const nodes: OpmlOutlineNode[] = [
      { text: "A", xmlUrl: "https://a.example.com/f.xml", category: "Comics" },
    ];

    expect(flattenOpmlOutlines(nodes)[0].folder).toBe("Comics");
  });

  it("lets an enclosing folder win over the feed's own category", () => {
    // Nesting is structure the author built; `category` is metadata on the
    // feed. When a file states both, the structure is the stronger claim.
    const nodes: OpmlOutlineNode[] = [
      {
        text: "Nested folder",
        outlines: [
          { text: "A", xmlUrl: "https://a.example.com/f.xml", category: "/Ignored" },
        ],
      },
    ];

    expect(flattenOpmlOutlines(nodes)[0].folder).toBe("Nested folder");
  });

  it("ignores a blank or slash-only category rather than inventing a folder", () => {
    const nodes: OpmlOutlineNode[] = [
      { text: "A", xmlUrl: "https://a.example.com/f.xml", category: "   " },
      { text: "B", xmlUrl: "https://b.example.com/f.xml", category: "///" },
      { text: "C", xmlUrl: "https://c.example.com/f.xml" },
    ];

    expect(flattenOpmlOutlines(nodes).map((sub) => sub.folder)).toEqual([null, null, null]);
  });
});
