import { describe, expect, it, vi } from "vitest";
import { feedsmithOpmlCodec } from "../adapters/opml/feedsmithOpmlCodec";
import { createFeed, type Feed } from "../domain/models/Feed";
import { flattenOpmlOutlines } from "../domain/opml/opmlSubscriptions";
import type { LocalStorePort } from "../ports/LocalStorePort";
import { exportOpml, OPML_DOCUMENT_TITLE } from "./exportOpml";

function makeFeed(url: string, title: string, folder: string | null): Feed {
  return createFeed({
    id: url,
    url,
    normalizedUrl: url,
    title,
    folder,
    addedAt: "2024-06-01T00:00:00.000Z",
  });
}

function depsWith(listFeeds: LocalStorePort["listFeeds"]) {
  return {
    localStore: { listFeeds } as unknown as LocalStorePort,
    opmlCodec: feedsmithOpmlCodec,
    clock: { now: () => "2024-06-01T00:00:00.000Z" },
  };
}

describe("exportOpml", () => {
  it("writes every subscription, grouped by folder, readable by the same codec", async () => {
    const feeds = [
      makeFeed("https://one.example.com/feed.xml", "One", "Tech"),
      makeFeed("https://two.example.com/feed.xml", "Two", null),
      makeFeed("https://three.example.com/feed.xml", "Three", "Tech"),
    ];
    const result = await exportOpml(depsWith(vi.fn().mockResolvedValue(feeds)));

    expect(result.status).toBe("exported");
    if (result.status !== "exported") return;
    expect(result.feedCount).toBe(3);
    expect(result.xml).toContain(`<title>${OPML_DOCUMENT_TITLE}</title>`);

    const parsed = feedsmithOpmlCodec.parse(result.xml);
    if (parsed.status !== "parsed") throw new Error("exported document is not readable");
    expect(flattenOpmlOutlines(parsed.outlines)).toEqual([
      { url: "https://one.example.com/feed.xml", title: "One", folder: "Tech", note: null },
      { url: "https://three.example.com/feed.xml", title: "Three", folder: "Tech", note: null },
      { url: "https://two.example.com/feed.xml", title: "Two", folder: null, note: null },
    ]);
  });

  it("exports a valid, readable document when there are no subscriptions", async () => {
    const result = await exportOpml(depsWith(vi.fn().mockResolvedValue([])));

    expect(result.status).toBe("exported");
    if (result.status !== "exported") return;
    expect(result.feedCount).toBe(0);
    expect(feedsmithOpmlCodec.parse(result.xml).status).toBe("parsed");
  });

  it("reports a store failure as a typed result rather than throwing", async () => {
    const result = await exportOpml(
      depsWith(vi.fn().mockRejectedValue(new Error("database is closed"))),
    );

    expect(result.status).toBe("failed");
    if (result.status !== "failed") return;
    expect(result.message).toContain("database is closed");
  });
});

describe("exportOpml — feed notes", () => {
  it("writes each feed's note as its description, and reads back identically", async () => {
    const feeds = [
      { ...makeFeed("https://one.example.com/feed.xml", "One", "Tech"), note: "Deep dives only." },
      { ...makeFeed("https://two.example.com/feed.xml", "Two", null), note: null },
    ];

    const result = await exportOpml(depsWith(vi.fn().mockResolvedValue(feeds)));
    if (result.status !== "exported") throw new Error("expected an exported document");

    expect(result.xml).toContain('description="Deep dives only."');

    const parsed = feedsmithOpmlCodec.parse(result.xml);
    if (parsed.status !== "parsed") throw new Error("exported document is not readable");
    expect(flattenOpmlOutlines(parsed.outlines).map((sub) => sub.note)).toEqual([
      "Deep dives only.",
      null,
    ]);
  });

  it("round-trips a multi-line note through the document", async () => {
    const note = "Why I follow this:\n- deep dives\n- no breaking news";
    const feeds = [{ ...makeFeed("https://one.example.com/feed.xml", "One", null), note }];

    const result = await exportOpml(depsWith(vi.fn().mockResolvedValue(feeds)));
    if (result.status !== "exported") throw new Error("expected an exported document");

    const parsed = feedsmithOpmlCodec.parse(result.xml);
    if (parsed.status !== "parsed") throw new Error("exported document is not readable");
    expect(flattenOpmlOutlines(parsed.outlines)[0].note).toBe(note);
  });
});
