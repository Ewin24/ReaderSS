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
 * Fallback number of top-level blocks per content page, used when no
 * viewport-derived size is supplied (~5-8 keeps each page a readable unit
 * without excessive page turns). Documented choice: 6.
 *
 * The reading pane derives its real page size from the pane's measured
 * height (`useViewportPageSize`); this constant is the headless/test default
 * only. Every function here takes `perPage` explicitly so the value used to
 * COUNT pages can never drift from the value used to SLICE them.
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

/**
 * Every HTML void element. These have no closing tag, so they must NEVER
 * increment nesting depth.
 *
 * REGRESSION THIS PREVENTS (the reason this set exists): the scanner used to
 * treat any nested opening tag as depth-increasing. A `<br>` or `<img>`
 * inside a paragraph therefore pushed depth to 1, and that paragraph's own
 * `</p>` was then consumed as if it closed the void element. The block never
 * closed, the body was flagged malformed, and the splitter degraded to a
 * single block -- silently disabling content pagination for practically
 * every real article, since inline images and line breaks are ubiquitous in
 * feeds.
 */
const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

/** Void elements that stand alone as their own block at depth 0. (`br` stays
 * inside loose text -- it is a line break within a paragraph, not a block.) */
const STANDALONE_VOID_TAGS = new Set(["img", "hr"]);

/**
 * Generic containers that carry no semantics worth preserving when they are
 * the body's ONLY top-level node. Many feeds wrap an entire article in one
 * of these, which by definition is a single top-level block and therefore
 * never paginates. Unwrapping such a wrapper exposes its children as the
 * real blocks.
 *
 * Deliberately excludes semantic containers (`blockquote`, `figure`, `pre`,
 * `table`, lists): dropping those would change what the content MEANS, and
 * the cost of not paginating a quote-only body is far lower.
 *
 * Tradeoff, stated rather than hidden: unwrapping discards the wrapper's own
 * attributes (e.g. a `class`). The pane renders into its own styled
 * `article` container, so this is accepted.
 */
const UNWRAPPABLE_TAGS = new Set(["div", "article", "section", "main", "body"]);

/** Bounds the unwrap recursion; a body nested deeper than this is left alone. */
const MAX_UNWRAP_DEPTH = 4;

interface ParsedTag {
  name: string;
  isClosing: boolean;
  isSelfClosing: boolean;
  end: number;
}

function parseTagAt(html: string, index: number): ParsedTag | null {
  const tagEnd = html.indexOf(">", index);
  if (tagEnd === -1) return null;
  const tagContent = html.slice(index + 1, tagEnd);
  const isClosing = tagContent.startsWith("/");
  const name = (isClosing ? tagContent.slice(1) : tagContent)
    .trimStart()
    .split(/[\s/>]/)[0]
    .toLowerCase();
  return { name, isClosing, isSelfClosing: /\/\s*>$/.test(tagContent), end: tagEnd };
}

/**
 * The raw scanner. Returns the top-level blocks, or `null` when the input is
 * malformed/unclosed (the caller decides how to degrade).
 */
function scanTopLevelBlocks(html: string): string[] | null {
  const blocks: string[] = [];
  let current = "";
  let topLevelTag: string | null = null; // open top-level block tag, or null (loose text)
  let depth = 0; // nesting depth within the open top-level block
  let i = 0;
  const n = html.length;

  while (i < n) {
    const char = html[i];
    if (char !== "<") {
      current += char;
      i += 1;
      continue;
    }

    const tag = parseTagAt(html, i);
    if (tag === null) {
      // No closing '>' for this tag: the remainder is text. If we are inside
      // an open top-level block it is unclosed -> malformed.
      if (topLevelTag !== null) return null;
      current += html.slice(i);
      break;
    }

    const raw = html.slice(i, tag.end + 1);

    if (tag.isClosing) {
      if (topLevelTag === null) return null; // stray close at depth 0
      if (depth > 0) {
        depth -= 1;
        current += raw;
        i = tag.end + 1;
        continue;
      }
      if (tag.name !== topLevelTag) return null; // mismatched close at depth 0
      current += raw;
      blocks.push(current);
      current = "";
      topLevelTag = null;
      i = tag.end + 1;
      continue;
    }

    // Opening tag.
    if (topLevelTag !== null) {
      // Inside an open top-level block -> nested content. Void and
      // self-closing elements have no matching close, so they must not
      // change depth (see VOID_TAGS).
      if (!tag.isSelfClosing && !VOID_TAGS.has(tag.name)) depth += 1;
      current += raw;
      i = tag.end + 1;
      continue;
    }

    // Depth 0.
    if (STANDALONE_VOID_TAGS.has(tag.name)) {
      // img/hr stand alone as their own block.
      if (current.length > 0) blocks.push(current);
      blocks.push(raw);
      current = "";
      i = tag.end + 1;
      continue;
    }
    if (BLOCK_TAGS.has(tag.name)) {
      // A new top-level block: finalize any loose text first.
      if (current.length > 0) blocks.push(current);
      current = raw;
      if (tag.isSelfClosing) {
        blocks.push(current);
        current = "";
      } else {
        topLevelTag = tag.name;
        depth = 0;
      }
      i = tag.end + 1;
      continue;
    }

    // Inline tag at depth 0 -> part of the loose-text block.
    current += raw;
    i = tag.end + 1;
  }

  if (topLevelTag !== null) return null; // open block never closed
  if (current.length > 0) blocks.push(current);
  return blocks;
}

/**
 * Returns the inner HTML of `block` when it is exactly one unwrappable
 * container element spanning the whole string, else `null`.
 */
function unwrapContainer(block: string): string | null {
  if (!block.startsWith("<")) return null;
  const open = parseTagAt(block, 0);
  if (open === null || open.isClosing || open.isSelfClosing) return null;
  if (!UNWRAPPABLE_TAGS.has(open.name)) return null;
  const closing = `</${open.name}>`;
  const trimmedEnd = block.trimEnd();
  if (!trimmedEnd.toLowerCase().endsWith(closing)) return null;
  return trimmedEnd.slice(open.end + 1, trimmedEnd.length - closing.length);
}

/**
 * Splits clean HTML into top-level blocks. Returns a single block (the whole
 * input) when the input is malformed/unclosed, so pagination silently
 * degrades to no-pagination rather than ever splitting mid-tag.
 *
 * When the body is one generic container wrapping everything, its children
 * are used as the blocks instead (see {@link UNWRAPPABLE_TAGS}) -- otherwise
 * a wrapped article could never paginate at all.
 */
export function splitTopLevelHtmlBlocks(html: string): string[] {
  if (html.length === 0) return [""];

  const blocks = scanTopLevelBlocks(html);
  if (blocks === null) return [html];
  if (blocks.length !== 1) return blocks;

  // Single top-level node: try to unwrap generic containers until the
  // content actually branches. Falls back to the un-unwrapped result.
  let candidate = blocks[0];
  for (let depth = 0; depth < MAX_UNWRAP_DEPTH; depth += 1) {
    const inner = unwrapContainer(candidate);
    if (inner === null) break;
    const innerBlocks = scanTopLevelBlocks(inner);
    if (innerBlocks === null || innerBlocks.length === 0) break;
    if (innerBlocks.length > 1) return innerBlocks;
    candidate = innerBlocks[0];
  }
  return blocks;
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
