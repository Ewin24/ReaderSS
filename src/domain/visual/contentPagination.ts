/**
 * Content pagination over an ALREADY-SANITIZED HTML body. The reading pane
 * splits a clean (single-pass sanitized) entry body into top-level blocks
 * and groups them into fixed-size pages so the pane can paginate CONTENT in
 * `navMode="paginated"`, mirroring the entry-list pagination model.
 *
 * SAFETY (do not reorder): this module operates ONLY on the clean output of
 * the single sanitize choke point (`src/ui/components/SafeHtml`). It must
 * NEVER be run on raw feed HTML. The splitter is a pure string scanner that
 * only re-groups already-closed top-level nodes by bracket depth -- it never
 * parses attributes, never creates tags, and never constructs new markup, so
 * it cannot introduce XSS. Malformed/unclosed input degrades to a single
 * block (no pagination) rather than splitting mid-tag.
 *
 * Pure functions; no DOM, no store (matches `pagination.ts`).
 */
import { clampPage } from "./pagination";

/**
 * Number of top-level blocks rendered per content page (~5-8 keeps each page
 * a readable unit without excessive page turns). Documented choice: 6.
 */
export const CONTENT_PAGE_SIZE = 6;

/** Block-level elements that open a new top-level block at depth 0. */
const BLOCK_TAGS = new Set([
  "p",
  "div",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "table",
  "blockquote",
  "pre",
  "section",
  "article",
  "figure",
  "header",
  "footer",
  "nav",
  "aside",
  "main",
]);

/** Void elements that stand alone as their own block at depth 0. (`br` stays
 * inside loose text -- it is a line break within a paragraph, not a block.) */
const STANDALONE_VOID_TAGS = new Set(["img", "hr"]);

/**
 * Splits clean HTML into top-level blocks. Returns a single block (the whole
 * input) when the input is malformed/unclosed, so pagination silently
 * degrades to no-pagination rather than ever splitting mid-tag.
 */
export function splitTopLevelHtmlBlocks(html: string): string[] {
  if (html.length === 0) return [""];

  const blocks: string[] = [];
  let current = "";
  let topLevelTag: string | null = null; // open top-level block tag, or null (loose text)
  let depth = 0; // nesting depth within the open top-level block
  let malformed = false;
  let i = 0;
  const n = html.length;

  while (i < n) {
    const char = html[i];
    if (char !== "<") {
      current += char;
      i += 1;
      continue;
    }

    const tagEnd = html.indexOf(">", i);
    if (tagEnd === -1) {
      // No closing '>' for this tag: the remainder is text. If we are inside
      // an open top-level block it is unclosed → malformed.
      if (topLevelTag !== null) malformed = true;
      current += html.slice(i);
      break;
    }

    const tagContent = html.slice(i + 1, tagEnd);
    const isClosing = tagContent.startsWith("/");
    const tagName = (
      isClosing ? tagContent.slice(1) : tagContent
    )
      .trimStart()
      .split(/[\s/>]/)[0]
      .toLowerCase();
    const isSelfClosing = /\/\s*>$/.test(tagContent);

    if (isClosing) {
      if (topLevelTag !== null && depth > 0) {
        // Nested close inside the top-level block → descend.
        depth -= 1;
      } else if (topLevelTag !== null && depth === 0) {
        if (tagName === topLevelTag) {
          // Matched close of the top-level block → finalize it.
          current += html.slice(i, tagEnd + 1);
          blocks.push(current);
          current = "";
          topLevelTag = null;
          i = tagEnd + 1;
          continue;
        }
        // Mismatched close while a top-level block is open at depth 0.
        malformed = true;
        current += html.slice(i, tagEnd + 1);
        i = tagEnd + 1;
        continue;
      } else {
        // Stray closing tag at depth 0 with no open block → malformed.
        malformed = true;
        current += html.slice(i, tagEnd + 1);
        i = tagEnd + 1;
        continue;
      }
      current += html.slice(i, tagEnd + 1);
      i = tagEnd + 1;
      continue;
    }

    // Opening tag.
    if (topLevelTag !== null) {
      // Inside an open top-level block → nested content.
      if (!isSelfClosing) depth += 1;
      current += html.slice(i, tagEnd + 1);
      i = tagEnd + 1;
      continue;
    }

    // Depth 0.
    if (BLOCK_TAGS.has(tagName)) {
      // A new top-level block: finalize any loose text first.
      if (current.length > 0) blocks.push(current);
      current = html.slice(i, tagEnd + 1);
      if (isSelfClosing) {
        blocks.push(current);
        current = "";
      } else {
        topLevelTag = tagName;
        depth = 0;
      }
      i = tagEnd + 1;
      continue;
    }
    if (STANDALONE_VOID_TAGS.has(tagName)) {
      // img/hr stand alone as their own block.
      if (current.length > 0) blocks.push(current);
      current = html.slice(i, tagEnd + 1);
      blocks.push(current);
      current = "";
      i = tagEnd + 1;
      continue;
    }

    // Inline tag at depth 0 → part of the loose-text block.
    current += html.slice(i, tagEnd + 1);
    i = tagEnd + 1;
  }

  if (topLevelTag !== null) malformed = true; // open block never closed
  if (current.length > 0) blocks.push(current);

  return malformed ? [html] : blocks;
}

/** Number of content pages for a block list (1 when empty — an empty body is
 * a single, empty page rather than zero pages). */
export function contentPageCount(blocks: readonly string[], perPage = CONTENT_PAGE_SIZE): number {
  if (blocks.length === 0) return 1;
  return Math.max(1, Math.ceil(blocks.length / perPage));
}

/** Returns the requested 1-based page's blocks (page clamped to a valid range
 * via {@link clampPage}). */
export function contentPageBlocks(
  blocks: readonly string[],
  page: number,
  perPage = CONTENT_PAGE_SIZE,
): string[] {
  const count = contentPageCount(blocks, perPage);
  const clamped = clampPage(page, count);
  const start = (clamped - 1) * perPage;
  return blocks.slice(start, start + perPage);
}
