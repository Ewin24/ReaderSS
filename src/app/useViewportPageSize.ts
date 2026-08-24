/**
 * Tracks the height of the reading-pane element and returns a per-page block
 * count that fits within its visible viewport.
 *
 * Strategy: observe the pane's `clientHeight` via ResizeObserver, divide by
 * an estimated average block height (conservative 180px), and clamp to a
 * minimum of 1. This gives an organic page size that grows/shrinks with the
 * actual viewport instead of the hard-coded CONTENT_PAGE_SIZE constant.
 *
 * Degrades gracefully in test environments where ResizeObserver is unavailable
 * by returning the `fallback` value.
 */
import { useEffect, useRef, useState } from 'preact/hooks';

/** Estimated average height in pixels of one top-level HTML block. */
const AVG_BLOCK_HEIGHT_PX = 180;
const MIN_BLOCKS = 1;
const MAX_BLOCKS = 20;

export function useViewportPageSize(
  selector = '.reading-pane',
  fallback = 6,
): number {
  const [perPage, setPerPage] = useState(fallback);
  const observerRef = useRef<ResizeObserver | null>(null);

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;

    function measure(height: number) {
      const computed = Math.floor(height / AVG_BLOCK_HEIGHT_PX);
      setPerPage(Math.min(MAX_BLOCKS, Math.max(MIN_BLOCKS, computed)));
    }

    const el = document.querySelector(selector);
    if (!el) return;

    measure((el as HTMLElement).clientHeight);

    observerRef.current = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      measure(entry.contentRect.height);
    });
    observerRef.current.observe(el);

    return () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
    };
  }, [selector]);

  return perPage;
}
