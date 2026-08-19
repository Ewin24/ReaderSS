import type { RefObject } from "preact";
import { EntryListItem, type EntryListItemData } from "../EntryListItem/EntryListItem";

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
}

export function EntryList({
  entries,
  selectedEntryId,
  onSelectEntry,
  emptyMessage,
  listRef,
  onToggleRead,
  onToggleStar,
}: EntryListProps) {
  if (entries.length === 0) {
    return (
      <div class="entry-list entry-list--empty">
        <p class="empty-state">{emptyMessage ?? "This feed has no entries yet."}</p>
      </div>
    );
  }

  return (
    <ul class="entry-list" aria-label="Entries" tabIndex={-1} ref={listRef}>
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
  );
}
