import { describe, expect, it } from "vitest";
import { collectionNames, groupFeedsByFolder } from "./feedGrouping";

interface TestFeed {
  readonly id: string;
  readonly folder: string | null;
}

function feed(id: string, folder: string | null): TestFeed {
  return { id, folder };
}

describe("collectionNames", () => {
  it("lists the collections in use, sorted and deduplicated", () => {
    const feeds = [feed("a", "Tech"), feed("b", "Comics"), feed("c", "Tech"), feed("d", null)];

    expect(collectionNames(feeds)).toEqual(["Comics", "Tech"]);
  });

  it("is empty when nothing is filed", () => {
    expect(collectionNames([feed("a", null), feed("b", "   ")])).toEqual([]);
  });

  it("keeps names that differ only by case as distinct", () => {
    // Folder names arrive verbatim from other readers' OPML files. Merging
    // `Tech` into `tech` would rewrite what another program wrote.
    expect(collectionNames([feed("a", "Tech"), feed("b", "tech")])).toEqual(["tech", "Tech"]);
  });
});

describe("groupFeedsByFolder", () => {
  it("returns nothing for no feeds", () => {
    expect(groupFeedsByFolder([])).toEqual([]);
  });

  it("groups by collection, named ones alphabetically first", () => {
    const feeds = [feed("a", "Tech"), feed("b", "Comics"), feed("c", "Tech")];

    expect(groupFeedsByFolder(feeds)).toEqual([
      { folder: "Comics", feeds: [feed("b", "Comics")] },
      { folder: "Tech", feeds: [feed("a", "Tech"), feed("c", "Tech")] },
    ]);
  });

  it("puts the ungrouped bucket last", () => {
    const feeds = [feed("loose", null), feed("filed", "Tech")];

    expect(groupFeedsByFolder(feeds).map((group) => group.folder)).toEqual(["Tech", null]);
  });

  it("omits the ungrouped bucket entirely when everything is filed", () => {
    expect(groupFeedsByFolder([feed("a", "Tech")]).map((group) => group.folder)).toEqual(["Tech"]);
  });

  it("returns a single ungrouped bucket for a flat list, the common OPML shape", () => {
    const feeds = [feed("a", null), feed("b", null)];

    expect(groupFeedsByFolder(feeds)).toEqual([{ folder: null, feeds }]);
  });

  it("treats a blank folder name as ungrouped rather than a collection", () => {
    expect(groupFeedsByFolder([feed("a", "   ")])).toEqual([
      { folder: null, feeds: [feed("a", "   ")] },
    ]);
  });

  it("preserves the caller's feed order inside each group", () => {
    const feeds = [feed("c", "Tech"), feed("a", "Tech"), feed("b", "Tech")];

    expect(groupFeedsByFolder(feeds)[0].feeds.map((entry) => entry.id)).toEqual(["c", "a", "b"]);
  });

  it("loses no feed and duplicates none", () => {
    const feeds = [
      feed("a", "Tech"),
      feed("b", null),
      feed("c", "Comics"),
      feed("d", "Tech"),
      feed("e", null),
    ];

    const flattened = groupFeedsByFolder(feeds).flatMap((group) => group.feeds);
    expect(flattened).toHaveLength(feeds.length);
    expect(new Set(flattened.map((entry) => entry.id))).toEqual(
      new Set(feeds.map((entry) => entry.id)),
    );
  });

  it("never mutates the feeds it groups", () => {
    // Grouping is for DISPLAY: no feed's `folder` changes, so nothing named
    // "Uncategorized" can ever reach the store or an OPML export.
    const feeds = [feed("a", null)];
    groupFeedsByFolder(feeds);

    expect(feeds[0].folder).toBeNull();
  });
});
