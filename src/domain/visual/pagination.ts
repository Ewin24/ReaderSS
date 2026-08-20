/**
 * Fixed-viewport pagination over an already-loaded list. When `navMode` is
 * `paginated`, the entry list shows one page at a time (client-side slice of
 * the full loaded list) and advances pages at the viewport end — never a new
 * store query (design D5 / spec "Pagination page advance"). Pure functions;
 * no DOM or store access.
 */

/** Fixed page size (open question: not exposed in settings; see design). */
export const PAGINATED_PAGE_SIZE = 20;

/** Slices the full list down to the requested 1-based page. */
export function paginate<T>(items: readonly T[], page: number): T[] {
  const start = (page - 1) * PAGINATED_PAGE_SIZE;
  return items.slice(start, start + PAGINATED_PAGE_SIZE);
}

/** Number of pages for a list of the given length (0 when empty). */
export function pageCount<T>(items: readonly T[]): number {
  return Math.ceil(items.length / PAGINATED_PAGE_SIZE);
}

/** Clamps a 1-based page to the valid range `[1, pageCount]` (1 when empty). */
export function clampPage(page: number, count: number): number {
  if (count <= 0) return 1;
  return Math.min(Math.max(page, 1), count);
}

/**
 * Whether the scroll container has reached (or come within `threshold` px of)
 * the bottom of its scrollable content. `scrollTop + clientHeight >=
 * scrollHeight - threshold`. Returns true when there is no overflow to scroll.
 */
export function isAtViewportEnd(
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
  threshold = 8,
): boolean {
  return scrollTop + clientHeight >= scrollHeight - threshold;
}
