import { describe, expect, it } from "vitest";
import {
  DEFAULT_SEARCH_LIMIT,
  MIN_QUERY_LENGTH,
  emptySearchOutcome,
  htmlToText,
  searchCorpus,
  type SearchCorpus,
  type SearchableEntry,
  type SearchableFeed,
} from "./librarySearch";

function feed(overrides: Partial<SearchableFeed> & { id: string }): SearchableFeed {
  return { title: "A feed", note: null, ...overrides };
}

function entry(overrides: Partial<SearchableEntry> & { id: string }): SearchableEntry {
  return {
    feedId: "feed-1",
    title: "An entry",
    publishedAt: "2026-08-01T00:00:00.000Z",
    bodyHtml: null,
    ...overrides,
  };
}

function corpus(overrides: Partial<SearchCorpus> = {}): SearchCorpus {
  return { feeds: [feed({ id: "feed-1", title: "Hacker News" })], entries: [], ...overrides };
}

describe("searchCorpus — what counts as a match", () => {
  it("finds a feed by its title", () => {
    const outcome = searchCorpus(corpus(), "hacker");

    expect(outcome.results).toHaveLength(1);
    expect(outcome.results[0]).toMatchObject({
      kind: "feed",
      feedId: "feed-1",
      matchedIn: "title",
    });
  });

  it("finds a feed by the note you wrote about it", () => {
    // Often what you remember is why you subscribed, not what it is called.
    const outcome = searchCorpus(
      corpus({
        feeds: [feed({ id: "feed-1", title: "lobste.rs", note: "Best source for Rust posts" })],
      }),
      "rust posts",
    );

    expect(outcome.results[0]).toMatchObject({ kind: "feed", matchedIn: "note" });
  });

  it("finds an entry by its title", () => {
    const outcome = searchCorpus(
      corpus({ entries: [entry({ id: "e1", title: "Understanding CRDTs" })] }),
      "crdt",
    );

    expect(outcome.results[0]).toMatchObject({
      kind: "entry",
      entryId: "e1",
      matchedIn: "title",
    });
  });

  it("finds an entry by words in its body", () => {
    const outcome = searchCorpus(
      corpus({
        entries: [entry({ id: "e1", bodyHtml: "<p>A quiet note about <b>vector clocks</b>.</p>" })],
      }),
      "vector clocks",
    );

    expect(outcome.results[0]).toMatchObject({ kind: "entry", matchedIn: "body" });
  });

  it("ignores case and accents, in the text and in the query alike", () => {
    // A reader typing Spanish should not have to reproduce the author's
    // accents, nor the author the reader's.
    const found = searchCorpus(
      corpus({ entries: [entry({ id: "e1", title: "Un artículo sobre búsqueda" })] }),
      "ARTICULO",
    );
    expect(found.results).toHaveLength(1);

    const reverse = searchCorpus(
      corpus({ entries: [entry({ id: "e1", title: "Un articulo sobre busqueda" })] }),
      "artículo",
    );
    expect(reverse.results).toHaveLength(1);
  });

  it("never matches inside the markup, only in the text a reader can see", () => {
    // The class attribute says "vector", the prose does not. Matching it would
    // send someone to an article that never mentions what they searched for.
    const outcome = searchCorpus(
      corpus({
        entries: [entry({ id: "e1", bodyHtml: '<p class="vector-diagram">Nothing here.</p>' })],
      }),
      "vector",
    );

    expect(outcome.results).toHaveLength(0);
  });

  it("reports an entry that matches both title and body once, as a title match", () => {
    const outcome = searchCorpus(
      corpus({
        entries: [entry({ id: "e1", title: "On latency", bodyHtml: "<p>latency again</p>" })],
      }),
      "latency",
    );

    expect(outcome.results).toHaveLength(1);
    expect(outcome.results[0]).toMatchObject({ matchedIn: "title" });
  });

  it("returns nothing for a query shorter than the minimum", () => {
    const outcome = searchCorpus(corpus(), "h".repeat(MIN_QUERY_LENGTH - 1));

    expect(outcome.results).toHaveLength(0);
    expect(outcome.totalCount).toBe(0);
  });

  it("returns nothing for a query that is only whitespace", () => {
    expect(searchCorpus(corpus(), "     ").results).toHaveLength(0);
  });

  it("returns nothing for a query that folds away to nothing", () => {
    // Bare combining marks fold to an empty needle, which would otherwise
    // match at every position of every document.
    const outcome = searchCorpus(corpus(), "́̂");

    expect(outcome.results).toHaveLength(0);
  });

  it("attributes each entry to the feed it belongs to", () => {
    const outcome = searchCorpus(
      {
        feeds: [feed({ id: "feed-2", title: "Ars Technica" })],
        entries: [entry({ id: "e1", feedId: "feed-2", title: "Quantum something" })],
      },
      "quantum",
    );

    expect(outcome.results[0]).toMatchObject({ feedTitle: "Ars Technica" });
  });

  it("does not drop an entry whose feed is missing from the corpus", () => {
    // Losing the article because its feed row was not handed in would be a
    // silent hole in the results.
    const outcome = searchCorpus(
      { feeds: [], entries: [entry({ id: "e1", feedId: "gone", title: "Orphan" })] },
      "orphan",
    );

    expect(outcome.results[0]).toMatchObject({ feedTitle: "Unknown feed" });
  });
});

describe("searchCorpus — order", () => {
  it("puts feeds first, then title matches, then body matches", () => {
    const outcome = searchCorpus(
      {
        feeds: [feed({ id: "feed-1", title: "Signal blog" })],
        entries: [
          entry({ id: "body", title: "Untitled", bodyHtml: "<p>a signal in the noise</p>" }),
          entry({ id: "title", title: "Signal processing" }),
        ],
      },
      "signal",
    );

    expect(outcome.results.map((result) => result.kind)).toEqual(["feed", "entry", "entry"]);
    expect(outcome.results.map((result) => result.matchedIn)).toEqual(["title", "title", "body"]);
  });

  it("keeps the caller's own order inside each bucket", () => {
    // Entries arrive newest-first from the store; results must come out that
    // way rather than in whatever order the scan happened to visit them.
    const outcome = searchCorpus(
      corpus({
        entries: [
          entry({ id: "newer", title: "Rust in 2026", publishedAt: "2026-08-02T00:00:00.000Z" }),
          entry({ id: "older", title: "Rust in 2020", publishedAt: "2020-01-01T00:00:00.000Z" }),
        ],
      }),
      "rust",
    );

    expect(outcome.results.map((result) => (result as { entryId: string }).entryId)).toEqual([
      "newer",
      "older",
    ]);
  });
});

describe("searchCorpus — the limit is reported, never silent", () => {
  it("caps the results but tells you the real total", () => {
    const entries = Array.from({ length: DEFAULT_SEARCH_LIMIT + 7 }, (_, index) =>
      entry({ id: `e${index}`, title: `Kafka part ${index}` }),
    );

    const outcome = searchCorpus(corpus({ entries }), "kafka");

    expect(outcome.results).toHaveLength(DEFAULT_SEARCH_LIMIT);
    expect(outcome.totalCount).toBe(DEFAULT_SEARCH_LIMIT + 7);
  });

  it("honours an explicit limit", () => {
    const entries = Array.from({ length: 5 }, (_, index) =>
      entry({ id: `e${index}`, title: `Kafka ${index}` }),
    );

    const outcome = searchCorpus(corpus({ entries }), "kafka", { limit: 2 });

    expect(outcome.results).toHaveLength(2);
    expect(outcome.totalCount).toBe(5);
  });

  it("echoes the trimmed query, so a caller can drop a stale response", () => {
    expect(searchCorpus(corpus(), "  hacker  ").query).toBe("hacker");
  });
});

describe("searchCorpus — previews", () => {
  it("returns the match split from its surrounding text", () => {
    const outcome = searchCorpus(
      corpus({ entries: [entry({ id: "e1", title: "Reading the Kafka logs today" })] }),
      "kafka",
    );

    const { before, match, after } = outcome.results[0].snippet;
    expect(before).toBe("Reading the ");
    expect(match).toBe("Kafka");
    expect(after).toBe(" logs today");
  });

  it("keeps the ORIGINAL spelling in the preview, not the folded one", () => {
    // Matching is accent-insensitive; the preview is what the author wrote.
    const outcome = searchCorpus(
      corpus({ entries: [entry({ id: "e1", title: "Un artículo largo" })] }),
      "articulo",
    );

    expect(outcome.results[0].snippet.match).toBe("artículo");
    expect(outcome.results[0].snippet.after).toBe(" largo");
  });

  it("marks with an ellipsis where it cut a long body", () => {
    const filler = "palabra ".repeat(40);
    const outcome = searchCorpus(
      corpus({
        entries: [entry({ id: "e1", bodyHtml: `<p>${filler}aguja${filler}</p>` })],
      }),
      "aguja",
    );

    const { before, after } = outcome.results[0].snippet;
    expect(before.startsWith("…")).toBe(true);
    expect(after.endsWith("…")).toBe(true);
  });

  it("does not claim it cut text when it did not", () => {
    const outcome = searchCorpus(
      corpus({ entries: [entry({ id: "e1", title: "Short title" })] }),
      "short",
    );

    expect(outcome.results[0].snippet.before).toBe("");
    expect(outcome.results[0].snippet.after).toBe(" title");
  });
});

describe("htmlToText", () => {
  it("drops tags and keeps the words", () => {
    expect(htmlToText("<p>Hello <b>brave</b> world</p>")).toBe("Hello brave world");
  });

  it("keeps words apart when a block ends", () => {
    // Without this, "one" and "two" would fuse into "onetwo" and neither
    // would be findable.
    expect(htmlToText("<p>one</p><p>two</p>")).toBe("one two");
  });

  it("drops script and style bodies whole", () => {
    // Their contents are never on screen; matching them sends a reader to an
    // article that does not contain the word they searched for.
    expect(htmlToText("<style>.needle { color: red }</style><p>visible</p>")).toBe("visible");
    expect(htmlToText("<script>var needle = 1;</script><p>visible</p>")).toBe("visible");
  });

  it("drops comments", () => {
    expect(htmlToText("<!-- needle --><p>visible</p>")).toBe("visible");
  });

  it("decodes the entities feeds actually use", () => {
    expect(htmlToText("<p>Tom &amp; Jerry &lt;3 &quot;quotes&quot;&nbsp;here</p>")).toBe(
      'Tom & Jerry <3 "quotes" here',
    );
  });

  it("decodes numeric entities in both bases", () => {
    expect(htmlToText("<p>&#65;&#x42;</p>")).toBe("AB");
  });

  it("leaves an entity it does not know exactly as written", () => {
    // A literal `&mystery;` in a preview is honest; a guessed character is not.
    expect(htmlToText("<p>&mystery;</p>")).toBe("&mystery;");
  });

  it("collapses runs of whitespace so a preview stays one line", () => {
    expect(htmlToText("<p>a\n\n   b</p>")).toBe("a b");
  });
});

describe("emptySearchOutcome", () => {
  it("is empty and carries the trimmed query", () => {
    expect(emptySearchOutcome("  hi  ")).toEqual({ query: "hi", results: [], totalCount: 0 });
  });
});
