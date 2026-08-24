import type { RefObject } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { EntryListItem, type EntryListItemData } from "../EntryListItem/EntryListItem";
import { isAtViewportEnd } from "../../../domain/visual/pagination";

export interface EntryListProps {
  entries: EntryListItemData[];
  selectedEntryId: string | null;
  onSelectEntry: (entryId: string) => void;
  emptyMessage?: string;
  /** Focus fallback target for narrow-viewport back-navigation (see
   * App.tsx); optional so standalone renders/tests are unaffected. */
  listRef?: RefObject<HTMLUListElement>;
  /** Threaded straight through to every `EntryListItem` row; see that
   * component's doc comment for why both are optional. */
  onToggleRead?: (entryId: string) => void;
  onToggleStar?: (entryId: string) => void;
  /** Fixed-viewport pagination (navMode=paginated). When `page`/`pageCount`
   * are supplied a footer nav renders and `onScrollEnd` advances at the
   * viewport end; when absent the list renders exactly as before (infinite
   * scroll, no footer) — backward compatible. */
  page?: number;
  pageCount?: number;
  onPrevPage?: () => void;
  onNextPage?: () => void;
  onScrollEnd?: () => void;
}

export function EntryList({
  entries,
  selectedEntryId,
  onSelectEntry,
  emptyMessage,
  listRef,
  onToggleRead,
  onToggleStar,
  page,
  pageCount,
  onPrevPage,
  onNextPage,
  onScrollEnd,
}: EntryListProps) {
  if (entries.length === 0) {
    return (
      <div class="entry-list entry-list--empty">
        <p class="empty-state">{emptyMessage ?? "This feed has no entries yet."}</p>
      </div>
    );
  }

  const paginated = page !== undefined && pageCount !== undefined && pageCount > 0;
  // Improvement C: a single page (or fewer) has nothing to paginate, so hide
  // the footer instead of showing a "Page 1 of 1" bar with two dead buttons.
  const showPagination = paginated && pageCount !== undefined && pageCount > 1;
  const atFirstPage = paginated && page === 1;
  const atLastPage = paginated && page === pageCount;

  // BUG B: keep the scroll container at the top whenever the page changes so
  // each page starts at its beginning instead of landing mid/bottom. The ref is
  // owned here (so the reset works regardless of callers) and also forwarded to
  // `listRef` for the App's focus-fallback target.
  const listRefInternal = useRef<HTMLUListElement | null>(null);
  const setListRef = (el: HTMLUListElement | null) => {
    listRefInternal.current = el;
    if (listRef) listRef.current = el;
  };
  useEffect(() => {
    if (listRefInternal.current) {
      listRefInternal.current.scrollTop = 0;
    }
  }, [page]);

  const handleScroll = (event: Event) => {
    if (!onScrollEnd) return;
    const el = event.currentTarget as HTMLUListElement;
    // BUG A: only advance when the container actually overflows AND the user is
    // at the real end. A short page that does not fill the viewport has
    // scrollHeight <= clientHeight; without this guard any scroll event (or a
    // mount-triggered one) would spuriously jump pages.
    if (
      el.scrollHeight > el.clientHeight &&
      isAtViewportEnd(el.scrollTop, el.clientHeight, el.scrollHeight)
    ) {
      onScrollEnd();
    }
  };

  return (
    // The list and its pagination footer share ONE placed container.
    //
    // They used to be siblings in a Fragment, which made both of them direct
    // children of `.app-shell` -- and the footer had no `grid-area`, so it
    // fell into the implicit grid and rendered somewhere nobody chose. That is
    // exactly the defect grid.css's file comment describes. Wrapping them also
    // gives the footer its natural place: pinned under a list that scrolls
    // inside the column, instead of scrolling away with the entries.
    <div class="entry-list-pane">
      <ul
        class="entry-list"
        aria-label="Entries"
        tabIndex={-1}
        ref={setListRef}
        onScroll={onScrollEnd ? handleScroll : undefined}
      >
        {entries.map((entry) => (
          <EntryListItem
            key={entry.id}
            entry={entry}
            selected={entry.id === selectedEntryId}
            onSelect={onSelectEntry}
            onToggleRead={onToggleRead}
            onToggleStar={onToggleStar}
          />
        ))}
      </ul>
      {showPagination && (
        <nav class="entry-list__pagination" aria-label="Pagination">
          <span class="entry-list__pagination-page">
            Page {page} of {pageCount}
          </span>
          <button
            type="button"
            aria-label="Previous page"
            disabled={atFirstPage}
            onClick={onPrevPage}
          >
            Prev
          </button>
          <button
            type="button"
            aria-label="Next page"
            disabled={atLastPage}
            onClick={onNextPage}
          >
            Next
          </button>
        </nav>
      )}
    </div>
  );
}
