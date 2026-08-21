/**
 * Fixed-viewport pagination domain: client-side slicing over an already-loaded
 * list (spec "Pagination page advance" — advancing never runs a new store
 * query). Pure functions, no DOM, no store.
 */
import { describe, expect, it } from "vitest";
import { clampPage, isAtViewportEnd, pageCount, paginate, PAGINATED_PAGE_SIZE } from "./pagination";

describe("paginate", () => {
  it("slices by PAGINATED_PAGE_SIZE", () => {
    const items = Array.from({ length: 45 }, (_, i) => i);
    expect(PAGINATED_PAGE_SIZE).toBe(20);
    expect(paginate(items, 1)).toEqual(items.slice(0, 20));
    expect(paginate(items, 2)).toEqual(items.slice(20, 40));
    expect(paginate(items, 3)).toEqual(items.slice(40, 45));
  });

  it("returns an empty slice when the page has no items", () => {
    expect(paginate([], 1)).toEqual([]);
    expect(paginate([1, 2], 5)).toEqual([]);
  });
});

describe("pageCount", () => {
  it("rounds up the number of pages", () => {
    expect(pageCount([])).toBe(0);
    expect(pageCount(Array.from({ length: 20 }, (_, i) => i))).toBe(1);
    expect(pageCount(Array.from({ length: 21 }, (_, i) => i))).toBe(2);
    expect(pageCount(Array.from({ length: 45 }, (_, i) => i))).toBe(3);
  });
});

describe("clampPage", () => {
  it("bounds to [1, pageCount]", () => {
    expect(clampPage(0, 3)).toBe(1);
    expect(clampPage(1, 3)).toBe(1);
    expect(clampPage(2, 3)).toBe(2);
    expect(clampPage(99, 3)).toBe(3);
  });

  it("returns 1 when there are no pages (empty list)", () => {
    expect(clampPage(2, 0)).toBe(1);
  });
});

describe("isAtViewportEnd", () => {
  it("is true within the threshold of the end and false below it (default threshold 8)", () => {
    // scrollHeight=100, clientHeight=50 → bottom at scrollTop=50;
    // threshold 8 means true when scrollTop >= 50 - 8 = 42.
    expect(isAtViewportEnd(50, 50, 100)).toBe(true); // exactly at the end
    expect(isAtViewportEnd(42, 50, 100)).toBe(true); // within threshold
    expect(isAtViewportEnd(41, 50, 100)).toBe(false); // below threshold
    expect(isAtViewportEnd(0, 50, 100)).toBe(false); // far from the end
  });

  it("honors a custom threshold", () => {
    expect(isAtViewportEnd(42, 50, 100, 8)).toBe(true); // 50-42=8 within threshold
    expect(isAtViewportEnd(41, 50, 100, 8)).toBe(false);
    expect(isAtViewportEnd(41, 50, 100, 9)).toBe(true); // wider threshold
  });

  it("is true when there is no scrollable overflow", () => {
    expect(isAtViewportEnd(0, 50, 50)).toBe(true); // content fits exactly
    expect(isAtViewportEnd(0, 50, 40)).toBe(true); // content shorter than viewport
  });
});
