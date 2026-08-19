import type { RefObject } from "preact";
import { formatPublished } from "../formatPublished";
import { toSafeHref } from "../../../domain/url/safeUrl";
import { shortHash } from "../../../domain/identity/hash";
import { SafeHtml } from "../SafeHtml";

export interface ReadingPaneEntry {
  id: string;
  title: string;
  feedTitle: string;
  publishedAt: string;
  link: string;
  summary: string | null;
  content: string | null;
  read: 0 | 1;
  starred: 0 | 1;
}

export interface ReadingPaneProps {
  entry: ReadingPaneEntry | null;
  onBack?: () => void;
  /** Focus target for narrow-viewport navigation (see App.tsx); optional so
   * standalone renders/tests are unaffected. */
  headingRef?: RefObject<HTMLHeadingElement>;
  /**
   * Explicit "Mark as unread" action in the pane header (entry-reading spec
   * "Mark as unread is reachable as an explicit action", Amendment C) and
   * the star/unstar toggle. Both optional, same rationale as
   * `EntryListItem`'s toggle props: no handler means no control rendered,
   * rather than a button wired to a no-op. Opening an entry marking it read
   * is NOT this component's job -- that side effect belongs to whatever
   * binds real data to it (`ReadingPaneContainer`), since this component
   * stays presentational.
   */
  onToggleRead?: (entryId: string) => void;
  onToggleStar?: (entryId: string) => void;
}

interface ReadingPaneContentProps {
  entry: ReadingPaneEntry;
  headingRef?: RefObject<HTMLHeadingElement>;
}

function ReadingPaneContent({ entry, headingRef }: ReadingPaneContentProps) {
  // A feed can independently supply full content, only a summary, or
  // neither (entry-reading spec, "Summary-only entries link to the
  // original"). These two booleans classify which of those three states
  // this entry is in so the correct notice text is shown below; `body`
  // picks whichever of content/summary is present, and is falsy when both
  // are null.
  const isSummaryOnly = entry.content === null && entry.summary !== null;
  const hasNoContent = entry.content === null && entry.summary === null;
  const body = entry.content ?? entry.summary;
  const safeLink = toSafeHref(entry.link);

  return (
    <article class="reading-pane__article">
      <h1 class="reading-pane__title" tabIndex={-1} ref={headingRef}>
        {entry.title}
      </h1>
      <p class="reading-pane__meta">
        <span>{entry.feedTitle}</span>
        <time dateTime={entry.publishedAt}>{formatPublished(entry.publishedAt)}</time>
      </p>
      {isSummaryOnly && (
        <p class="reading-pane__notice">This is a summary provided by the feed.</p>
      )}
      {hasNoContent && (
        <p class="reading-pane__notice">This feed provided no content for this entry.</p>
      )}
      {body && (
        // The single enforced sanitization choke point (design.md §5):
        // `body` is raw, feed-supplied HTML and must never reach the DOM
        // through plain text interpolation (Slice 6's risk-lens finding --
        // Preact escapes `{body}`, so feed markup showed as literal source
        // text instead of rendering). `cacheKey` is derived here, inside
        // this component, rather than plumbed through `ReadingPaneEntry` as
        // a separate `contentHash` field: it is entirely a function of
        // `entry.id` plus the exact string being rendered, so hashing it
        // locally keeps the sanitizer's LRU memo correctly invalidated
        // (design.md §5: keyed on `entryId + contentHash`) without widening
        // this component's props or every caller that builds one.
        <SafeHtml html={body} cacheKey={`${entry.id}:${shortHash(body)}`} />
      )}
      {safeLink && (
        <a
          class="reading-pane__original-link"
          href={safeLink}
          target="_blank"
          rel="noopener noreferrer nofollow"
        >
          Read the original article
        </a>
      )}
    </article>
  );
}

export function ReadingPane({ entry, onBack, headingRef, onToggleRead, onToggleStar }: ReadingPaneProps) {
  return (
    <section class="reading-pane" aria-label="Reading pane">
      {onBack && (
        <button type="button" class="reading-pane__back" onClick={onBack}>
          Back to list
        </button>
      )}
      {entry && (onToggleRead || onToggleStar) && (
        <div class="reading-pane__actions">
          {onToggleRead && entry.read === 1 && (
            <button
              type="button"
              class="reading-pane__toggle-read"
              onClick={() => onToggleRead(entry.id)}
            >
              Mark as unread
            </button>
          )}
          {onToggleStar && (
            <button
              type="button"
              class="reading-pane__toggle-star"
              aria-pressed={entry.starred === 1}
              onClick={() => onToggleStar(entry.id)}
            >
              {entry.starred === 1 ? "Unstar" : "Star"}
            </button>
          )}
        </div>
      )}
      {entry ? (
        <ReadingPaneContent entry={entry} headingRef={headingRef} />
      ) : (
        <p class="empty-state">Select an entry to start reading.</p>
      )}
    </section>
  );
}
