import type { RefObject } from "preact";
import { formatPublished } from "../formatPublished";
import { toSafeHref } from "../../../domain/url/safeUrl";

export interface ReadingPaneEntry {
  id: string;
  title: string;
  feedTitle: string;
  publishedAt: string;
  link: string;
  summary: string | null;
  content: string | null;
}

export interface ReadingPaneProps {
  entry: ReadingPaneEntry | null;
  onBack?: () => void;
  /** Focus target for narrow-viewport navigation (see App.tsx); optional so
   * standalone renders/tests are unaffected. */
  headingRef?: RefObject<HTMLHeadingElement>;
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
      {body && <p class="reading-pane__body">{body}</p>}
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

export function ReadingPane({ entry, onBack, headingRef }: ReadingPaneProps) {
  return (
    <section class="reading-pane" aria-label="Reading pane">
      {onBack && (
        <button type="button" class="reading-pane__back" onClick={onBack}>
          Back to list
        </button>
      )}
      {entry ? (
        <ReadingPaneContent entry={entry} headingRef={headingRef} />
      ) : (
        <p class="empty-state">Select an entry to start reading.</p>
      )}
    </section>
  );
}
