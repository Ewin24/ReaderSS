import type { RefObject } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { formatPublished } from "../formatPublished";
import { toSafeHref } from "../../../domain/url/safeUrl";
import { shortHash } from "../../../domain/identity/hash";
import { isAtViewportEnd } from "../../../domain/visual/pagination";
import {
  CONTENT_PAGE_SIZE,
  contentPageBlocks,
  splitTopLevelHtmlBlocks,
} from "../../../domain/visual/contentPagination";
import { SafeHtml, useSanitizer } from "../SafeHtml";

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
   * Explicit "Mark as unread" action in the pane header, reachable as an
   * explicit action, and the star/unstar toggle. Both optional, same rationale as
   * `EntryListItem`'s toggle props: no handler means no control rendered,
   * rather than a button wired to a no-op. Opening an entry marking it read
   * is NOT this component's job -- that side effect belongs to whatever
   * binds real data to it (`ReadingPaneContainer`), since this component
   * stays presentational.
   */
  onToggleRead?: (entryId: string) => void;
  onToggleStar?: (entryId: string) => void;
  /**
   * Content pagination (navMode=paginated). When `page`/`pageCount` are
   * supplied (and `pageCount > 1`) the pane's body is split into top-level
   * blocks and shown one page at a time, with a footer nav and advance-at-end
   * on the pane's scroll container; when absent the pane renders the whole
   * body as before (backward compatible).
   */
  page?: number;
  pageCount?: number;
  onPrevPage?: () => void;
  onNextPage?: () => void;
  onScrollEnd?: () => void;
}

interface ReadingPaneContentProps {
  entry: ReadingPaneEntry;
  headingRef?: RefObject<HTMLHeadingElement>;
  page?: number;
  pageCount?: number;
}

function ReadingPaneContent({ entry, headingRef, page, pageCount }: ReadingPaneContentProps) {
  // A feed can independently supply full content, only a summary, or
  // neither, in which case summary-only entries link to the original.
  // These two booleans classify which of those three states
  // this entry is in so the correct notice text is shown below; `body`
  // picks whichever of content/summary is present, and is falsy when both
  // are null.
  const isSummaryOnly = entry.content === null && entry.summary !== null;
  const hasNoContent = entry.content === null && entry.summary === null;
  const body = entry.content ?? entry.summary;
  const safeLink = toSafeHref(entry.link);
  const paginated = page !== undefined && pageCount !== undefined && pageCount > 1;

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
      {body &&
        (paginated ? (
          <PaginatedContent body={body} entryId={entry.id} page={page} />
        ) : (
          // The single enforced sanitization choke point: `body` is raw,
          // feed-supplied HTML and must never reach the DOM through plain
          // text interpolation.
          <SafeHtml html={body} cacheKey={`${entry.id}:${shortHash(body)}`} />
        ))}
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

/**
 * Paginated body renderer (navMode=paginated). SAFETY: we split the CLEAN,
 * already-sanitized output of the single choke point (`useSanitizer` here is
 * the same DOMPurify SafeHtml uses) into top-level blocks, rejoin the current
 * page, and re-render through `<SafeHtml>` with a page-extended `cacheKey`.
 * The splitter never runs on raw feed HTML, and re-sanitizing an already-clean
 * page is idempotent-safe. Mounted only when there is body content AND more
 * than one page, so consumers without a sanitizer in the non-paginated path
 * are unaffected.
 */
function PaginatedContent({
  body,
  entryId,
  page,
}: {
  body: string;
  entryId: string;
  page: number;
}) {
  const sanitize = useSanitizer();
  const baseKey = `${entryId}:${shortHash(body)}`;
  const cleanBody = sanitize(body, baseKey);
  const blocks = splitTopLevelHtmlBlocks(cleanBody);
  const htmlToRender = contentPageBlocks(blocks, page, CONTENT_PAGE_SIZE).join("");
  return <SafeHtml html={htmlToRender} cacheKey={`${baseKey}:p${page}`} />;
}

export function ReadingPane({
  entry,
  onBack,
  headingRef,
  onToggleRead,
  onToggleStar,
  page,
  pageCount,
  onPrevPage,
  onNextPage,
  onScrollEnd,
}: ReadingPaneProps) {
  const paginated = page !== undefined && pageCount !== undefined && pageCount > 1;
  const atFirstPage = paginated && page === 1;
  const atLastPage = paginated && page === pageCount;

  // BUG B (mirrors EntryList): keep the pane's scroll container at the top on
  // every page change so each page starts at its beginning instead of landing
  // mid/bottom from the previous page's scroll position.
  const paneRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (paneRef.current) {
      paneRef.current.scrollTop = 0;
    }
  }, [page]);

  const handleScroll = (event: Event) => {
    if (!onScrollEnd) return;
    const el = event.currentTarget as HTMLElement;
    // BUG A (mirrors EntryList): only advance when the container actually
    // overflows AND the user is at the real end. A page that does not fill
    // the viewport has scrollHeight <= clientHeight; without this guard any
    // scroll event would spuriously jump pages.
    if (
      el.scrollHeight > el.clientHeight &&
      isAtViewportEnd(el.scrollTop, el.clientHeight, el.scrollHeight)
    ) {
      onScrollEnd();
    }
  };

  return (
    <section
      class="reading-pane"
      aria-label="Reading pane"
      ref={paneRef}
      onScroll={onScrollEnd ? handleScroll : undefined}
    >
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
        <ReadingPaneContent
          entry={entry}
          headingRef={headingRef}
          page={page}
          pageCount={pageCount}
        />
      ) : (
        <p class="empty-state">Select an entry to start reading.</p>
      )}
      {entry && paginated && (
        <nav class="reading-pane__pagination" aria-label="Pagination">
          <span class="reading-pane__pagination-page">
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
    </section>
  );
}
