import { formatPublished } from "../formatPublished";

export interface EntryListItemData {
  id: string;
  title: string;
  feedTitle: string;
  publishedAt: string;
  read: 0 | 1;
  starred: 0 | 1;
}

export interface EntryListItemProps {
  entry: EntryListItemData;
  selected: boolean;
  onSelect: (entryId: string) => void;
  /**
   * Read/unread and star/unstar toggles. Both are OPTIONAL: this component stays
   * presentational (props in, callbacks out) and renders no toggle control
   * at all when a handler is omitted, rather than wiring a button to a
   * no-op. `EntryListContainer` is what actually supplies these, bound to
   * `toggleRead`/`toggleStar` via the services context.
   */
  onToggleRead?: (entryId: string) => void;
  onToggleStar?: (entryId: string) => void;
}

export function EntryListItem({
  entry,
  selected,
  onSelect,
  onToggleRead,
  onToggleStar,
}: EntryListItemProps) {
  const readLabel = entry.read === 1 ? "read" : "unread";
  const publishedLabel = formatPublished(entry.publishedAt);
  // The visible <time> element below is inside an aria-hidden wrapper (kept
  // hidden to avoid double-announcing title/feed/date), so the published
  // time is included directly in the accessible name instead - otherwise a
  // screen-reader user could not perceive it at all, even though the list
  // must show published time per entry.
  const accessibleName = `${entry.title}, ${entry.feedTitle}, published ${publishedLabel}, ${readLabel}${
    entry.starred === 1 ? ", starred" : ""
  }`;

  return (
    <li
      class={`entry-list-item${selected ? " entry-list-item--selected" : ""}`}
    >
      <button
        type="button"
        class="entry-list-item__button"
        aria-current={selected ? "true" : undefined}
        aria-label={accessibleName}
        onClick={() => onSelect(entry.id)}
      >
        <span class="entry-list-item__title" aria-hidden="true">
          {entry.title}
        </span>
        <span class="entry-list-item__meta" aria-hidden="true">
          <span>{entry.feedTitle}</span>
          <time dateTime={entry.publishedAt}>{formatPublished(entry.publishedAt)}</time>
        </span>
        {entry.starred === 1 && (
          <span class="entry-list-item__star" aria-hidden="true">
            ★
          </span>
        )}
      </button>
      {/* Siblings of the select button, not nested inside it -- a <button>
          cannot legally contain another interactive control. */}
      {(onToggleRead || onToggleStar) && (
        <div class="entry-list-item__actions">
          {onToggleRead && (
            <button
              type="button"
              class="entry-list-item__toggle-read"
              aria-pressed={entry.read === 1}
              aria-label={`Mark "${entry.title}" as ${entry.read === 1 ? "unread" : "read"}`}
              title={entry.read === 1 ? "Mark as unread" : "Mark as read"}
              onClick={(event) => {
                event.stopPropagation();
                onToggleRead(entry.id);
              }}
            >
              <span aria-hidden="true" class="entry-list-item__icon">
                {entry.read === 1 ? "✓" : "●"}
              </span>
            </button>
          )}
          {onToggleStar && (
            <button
              type="button"
              class="entry-list-item__toggle-star"
              aria-pressed={entry.starred === 1}
              aria-label={`${entry.starred === 1 ? "Unstar" : "Star"} "${entry.title}"`}
              title={entry.starred === 1 ? "Unstar" : "Star"}
              onClick={(event) => {
                event.stopPropagation();
                onToggleStar(entry.id);
              }}
            >
              <span aria-hidden="true" class="entry-list-item__icon">
                {entry.starred === 1 ? "★" : "☆"}
              </span>
            </button>
          )}
        </div>
      )}
    </li>
  );
}
