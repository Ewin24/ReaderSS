/**
 * Content pagination domain: splits an ALREADY-SANITIZED HTML body into
 * top-level blocks with a pure, DOM-free string scanner, then groups blocks
 * into fixed-size pages. The splitter must never be run on raw feed HTML --
 * it operates only on the clean output of the single sanitize choke point
 * (see `src/ui/components/SafeHtml`). Pure functions, no DOM, no store.
 *
 * Safety invariants (verified here):
 * - Round-trip: concatenating every page's blocks equals the original clean
 *   body (split/rejoin preserves content -- no blocks lost or duplicated).
 * - Fail-safe: malformed / unclosed input degrades to a single block (no
 *   pagination) rather than splitting mid-tag.
 * - The splitter only re-groups already-closed top-level nodes; it never
 *   parses attributes or constructs markup, so it cannot introduce XSS.
 */
import { describe, expect, it } from "vitest";
import {
  CONTENT_PAGE_SIZE,
  contentPageBlocks,
  contentPageCount,
  splitTopLevelHtmlBlocks,
} from "./contentPagination";

describe("CONTENT_PAGE_SIZE", () => {
  it("groups a sensible number of blocks per page", () => {
    // ~5-8 keeps each page a readable unit without excessive page turns.
    expect(CONTENT_PAGE_SIZE).toBeGreaterThanOrEqual(5);
    expect(CONTENT_PAGE_SIZE).toBeLessThanOrEqual(8);
  });
});

describe("splitTopLevelHtmlBlocks", () => {
  it("returns a single block when the input has no top-level block tags", () => {
    expect(splitTopLevelHtmlBlocks("")).toEqual([""]);
    expect(splitTopLevelHtmlBlocks("just some text")).toEqual(["just some text"]);
  });

  it("keeps an inline-only body as a single block, preserving its markup", () => {
    const html = "Hello <strong>world</strong> and <em>more</em>.";
    expect(splitTopLevelHtmlBlocks(html)).toEqual([html]);
  });

  it("splits consecutive top-level block elements into separate blocks", () => {
    const blocks = splitTopLevelHtmlBlocks("<p>First</p><p>Second</p><p>Third</p>");
    expect(blocks).toEqual(["<p>First</p>", "<p>Second</p>", "<p>Third</p>"]);
  });

  it("preserves a block's full internal markup, including nested inline elements", () => {
    const blocks = splitTopLevelHtmlBlocks("<p>Hello <strong>world</strong></p><p>Next</p>");
    expect(blocks).toEqual(["<p>Hello <strong>world</strong></p>", "<p>Next</p>"]);
  });

  it("treats void elements (img, hr) as their own single-element blocks", () => {
    const blocks = splitTopLevelHtmlBlocks("<p>A</p><img src=\"x\"><p>B</p><hr><p>C</p>");
    expect(blocks).toEqual(["<p>A</p>", "<img src=\"x\">", "<p>B</p>", "<hr>", "<p>C</p>"]);
  });

  it("groups consecutive loose depth-0 text runs into one block (feeds that omit <p>)", () => {
    const html = "First paragraph text<br>continues without a p tag";
    const blocks = splitTopLevelHtmlBlocks(html);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toBe(html);
  });

  it("handles headings and list structures as top-level blocks", () => {
    const html = "<h1>Title</h1><ul><li>One</li><li>Two</li></ul><blockquote>Quote</blockquote>";
    expect(splitTopLevelHtmlBlocks(html)).toEqual([
      "<h1>Title</h1>",
      "<ul><li>One</li><li>Two</li></ul>",
      "<blockquote>Quote</blockquote>",
    ]);
  });

  it("degrades malformed/unclosed input to a single block (fail-safe: no pagination)", () => {
    const malformed = "<p>Unclosed paragraph<div>Div</div>";
    expect(splitTopLevelHtmlBlocks(malformed)).toEqual([malformed]);
  });

  it("preserves an img-only body as one block", () => {
    expect(splitTopLevelHtmlBlocks('<img src="photo.jpg" alt="photo">')).toEqual([
      '<img src="photo.jpg" alt="photo">',
    ]);
  });
});

describe("contentPageCount", () => {
  it("returns 1 for an empty or single-page block list", () => {
    expect(contentPageCount([])).toBe(1);
    expect(contentPageCount(["<p>a</p>"])).toBe(1);
  });

  it("rounds up when the block count exceeds a page", () => {
    const blocks = Array.from({ length: CONTENT_PAGE_SIZE + 1 }, (_, i) => `<p>${i}</p>`);
    expect(contentPageCount(blocks)).toBe(2);
  });

  it("returns exactly one page when blocks fit within a single page", () => {
    const blocks = Array.from({ length: CONTENT_PAGE_SIZE }, (_, i) => `<p>${i}</p>`);
    expect(contentPageCount(blocks)).toBe(1);
  });
});

describe("contentPageBlocks", () => {
  it("returns the first page slice for page 1", () => {
    const blocks = Array.from({ length: CONTENT_PAGE_SIZE + 2 }, (_, i) => `<p>${i}</p>`);
    expect(contentPageBlocks(blocks, 1)).toEqual(blocks.slice(0, CONTENT_PAGE_SIZE));
  });

  it("returns the remaining blocks on the last page", () => {
    const blocks = Array.from({ length: CONTENT_PAGE_SIZE + 2 }, (_, i) => `<p>${i}</p>`);
    expect(contentPageBlocks(blocks, 2)).toEqual(blocks.slice(CONTENT_PAGE_SIZE));
  });

  it("clamps an out-of-range page to the valid range via clampPage", () => {
    const blocks = Array.from({ length: CONTENT_PAGE_SIZE * 2 }, (_, i) => `<p>${i}</p>`);
    expect(contentPageBlocks(blocks, 0)).toEqual(blocks.slice(0, CONTENT_PAGE_SIZE)); // clamped to 1
    expect(contentPageBlocks(blocks, 99)).toEqual(blocks.slice(CONTENT_PAGE_SIZE)); // clamped to 2
  });

  it("returns an empty slice for an empty block list", () => {
    expect(contentPageBlocks([], 1)).toEqual([]);
  });
});

describe("round-trip invariant: split then rejoin every page preserves the clean body", () => {
  it("rejoining all pages of a multi-page body equals the original clean HTML", () => {
    const blocks = [
      "<h1>Title</h1>",
      "<p>Intro paragraph.</p>",
      "<img src=\"a.jpg\">",
      "<p>Second paragraph.</p>",
      "<ul><li>One</li><li>Two</li></ul>",
      "<blockquote>A quote.</blockquote>",
      "<p>Closing paragraph.</p>",
    ];
    // Force multiple pages regardless of CONTENT_PAGE_SIZE.
    const perPage = 3;
    const pageCount = contentPageCount(blocks, perPage);
    expect(pageCount).toBe(3);

    const rejoined = Array.from(
      { length: pageCount },
      (_, pageIndex) => contentPageBlocks(blocks, pageIndex + 1, perPage).join(""),
    ).join("");

    expect(rejoined).toBe(blocks.join(""));
  });

  it("rejoining the single page of a single-page body is identical to the input", () => {
    const html = "<p>A</p><p>B</p>";
    const blocks = splitTopLevelHtmlBlocks(html);
    expect(contentPageBlocks(blocks, 1).join("")).toBe(html);
  });

  it("rejoining all split blocks equals the original for a mixed body", () => {
    const html = "<p>First</p>Loose text <em>inline</em><p>Second</p><img src=\"x\">";
    const blocks = splitTopLevelHtmlBlocks(html);
    expect(blocks.join("")).toBe(html);
  });
});
