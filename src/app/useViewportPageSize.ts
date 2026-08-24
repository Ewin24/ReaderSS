/**
 * Tracks the height of the reading-pane element and returns a per-page block
 * count that fits within its visible viewport.
 *
 * Strategy: observe the pane's `clientHeight` via ResizeObserver, divide by
 * an estimated average block height, and clamp. This gives an organic page
 * size that grows/shrinks with the actual viewport instead of the hard-coded
 * CONTENT_PAGE_SIZE constant.
 *
 * PRECONDITION (see `src/styles/grid.css`): the pane must be height-bounded
 * by the shell and carry `min-height: 0`, so it scrolls internally instead
 * of growing to its content. If the pane grows instead, this hook measures
 * the whole article and reports the maximum block count -- which is exactly
 * how content pagination silently collapsed into one enormous page.
 *
 * MOUNT ORDERING: the pane is NOT always in the DOM when this hook first
 * runs -- on a narrow viewport `App` renders the entry list instead until an
 * entry is opened. A one-shot `querySelector` in the effect therefore found
 * nothing and left the value pinned at the fallback forever. When the
 * element is absent we watch for it with a MutationObserver and attach as
 * soon as it appears, rather than requiring the caller to thread a
 * "the pane exists now" dependency in from outside.
 *
 * Degrades gracefully where ResizeObserver is unavailable (jsdom) by
 * returning the `fallback` value.
 */
import { useEffect, useState } from "preact/hooks";

/** Estimated average height in pixels of one top-level HTML block. */
const AVG_BLOCK_HEIGHT_PX = 180;
const MIN_BLOCKS = 1;
const MAX_BLOCKS = 20;

export function useViewportPageSize(selector = ".reading-pane", fallback = 6): number {
  const [perPage, setPerPage] = useState(fallback);

  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;

    let resizeObserver: ResizeObserver | null = null;
    let mutationObserver: MutationObserver | null = null;

    function measure(height: number) {
      const computed = Math.floor(height / AVG_BLOCK_HEIGHT_PX);
      setPerPage(Math.min(MAX_BLOCKS, Math.max(MIN_BLOCKS, computed)));
    }

    function attach(el: HTMLElement): void {
      measure(el.clientHeight);
      resizeObserver = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (!entry) return;
        measure(entry.contentRect.height);
      });
      resizeObserver.observe(el);
    }

    const existing = document.querySelector(selector);
    if (existing) {
      attach(existing as HTMLElement);
    } else if (typeof MutationObserver !== "undefined") {
      // The pane is not mounted yet; attach the moment it is.
      mutationObserver = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (!el) return;
        mutationObserver?.disconnect();
        mutationObserver = null;
        attach(el as HTMLElement);
      });
      mutationObserver.observe(document.body, { childList: true, subtree: true });
    }

    return () => {
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
  }, [selector]);

  return perPage;
}
