import type { RefObject } from "preact";
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
  const atFirstPage = paginated && page === 1;
  const atLastPage = paginated && page === pageCount;

  const handleScroll = (event: Event) => {
    if (!onScrollEnd) return;
    const el = event.currentTarget as HTMLUListElement;
    if (isAtViewportEnd(el.scrollTop, el.clientHeight, el.scrollHeight)) {
      onScrollEnd();
    }
  };

  return (
    <>
      <ul
        class="entry-list"
        aria-label="Entries"
        tabIndex={-1}
        ref={listRef}
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
      {paginated && (
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
    </>
  );
}
