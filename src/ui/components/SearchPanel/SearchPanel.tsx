/**
 * One box that searches everything: feed titles, the notes you wrote on
 * them, entry titles, and entry bodies across every feed -- not only the one
 * you happen to be reading.
 *
 * Presentational only: it renders the query it is handed and reports typing
 * and clicks back out. No debounce, no store, no service -- the container
 * owns all of that.
 *
 * PREVIEWS ARE TEXT, and that is a security property, not a detail. A result
 * shows the words around the match, taken from feed HTML by the domain's
 * `htmlToText`. It arrives already split into `before` / `match` / `after`,
 * so the highlight is built from ELEMENTS here (`<mark>{match}</mark>`) and
 * no string is ever interpreted as markup. The single sanitization choke
 * point (`SafeHtml`) is for the article you open, not for a preview line.
 *
 * NOT a combobox. The results are a plain list of buttons under a labelled
 * input rather than an ARIA combobox/listbox with managed active-descendant
 * focus: the list can be reached by Tab, every row is a real button, and
 * nothing depends on a roving-focus implementation that is easy to get
 * subtly wrong. A live region announces how the search went.
 */
import type { SearchResult, SearchSnippet } from "../../../domain/search/librarySearch";
import { formatPublished } from "../formatPublished";

export type SearchPanelStatus = "idle" | "searching" | "done" | "error";

export interface SearchPanelProps {
  readonly query: string;
  readonly onQueryChange: (query: string) => void;
  readonly status: SearchPanelStatus;
  readonly results: readonly SearchResult[];
  /** How many matched in total; `results` may be a capped slice of it. */
  readonly totalCount: number;
  readonly errorMessage: string | null;
  readonly onSelectResult: (result: SearchResult) => void;
  readonly onClear: () => void;
}

/** A stable key per result -- feed ids and entry ids never collide across kinds. */
function keyFor(result: SearchResult): string {
  return result.kind === "feed" ? `feed:${result.feedId}` : `entry:${result.entryId}`;
}

function Snippet({ snippet }: { readonly snippet: SearchSnippet }) {
  return (
    <span class="search-panel__snippet">
      {snippet.before}
      <mark class="search-panel__hit">{snippet.match}</mark>
      {snippet.after}
    </span>
  );
}

/** What the row says it will do, in words, for the accessible name. */
function describeResult(result: SearchResult): string {
  if (result.kind === "feed") {
    return result.matchedIn === "title"
      ? `Feed: ${result.feedTitle}`
      : `Feed: ${result.feedTitle}, matched in your note`;
  }
  const where = result.matchedIn === "title" ? "matched in the title" : "matched in the text";
  return `${result.title}, in ${result.feedTitle}, ${where}`;
}

function ResultRow({
  result,
  onSelect,
}: {
  readonly result: SearchResult;
  readonly onSelect: () => void;
}) {
  return (
    <li class={`search-panel__result search-panel__result--${result.kind}`}>
      <button
        type="button"
        class="search-panel__result-button"
        aria-label={describeResult(result)}
        onClick={onSelect}
      >
        <span class="search-panel__result-head" aria-hidden="true">
          <span class="search-panel__kind">{result.kind === "feed" ? "Feed" : "Article"}</span>
          <span class="search-panel__title">
            {result.kind === "feed" ? result.feedTitle : result.title}
          </span>
        </span>
        <span class="search-panel__result-meta" aria-hidden="true">
          {result.kind === "entry" && (
            <>
              <span class="search-panel__feed">{result.feedTitle}</span>
              <span class="search-panel__date">{formatPublished(result.publishedAt)}</span>
            </>
          )}
          {result.kind === "feed" && result.matchedIn === "note" && (
            <span class="search-panel__feed">from your note</span>
          )}
        </span>
        <Snippet snippet={result.snippet} />
      </button>
    </li>
  );
}

/**
 * The one line that says how the search went. It is also the live region, so
 * a screen-reader user hears the outcome without going looking for it.
 *
 * The capped count is SPOKEN, never swallowed: showing twenty of fifty-seven
 * matches while implying that is all of them is the kind of quiet lie this
 * project keeps out.
 */
function statusText(
  status: SearchPanelStatus,
  shown: number,
  totalCount: number,
): string | null {
  // The error has its own alert below; saying it twice is noise.
  if (status === "error") return null;
  if (status === "searching") return "Searching…";
  if (status !== "done") return null;
  if (totalCount === 0) return "No matches.";
  if (shown < totalCount) {
    return `Showing the first ${shown} of ${totalCount} matches. Narrow the search to see the rest.`;
  }
  return totalCount === 1 ? "1 match." : `${totalCount} matches.`;
}

export function SearchPanel({
  query,
  onQueryChange,
  status,
  results,
  totalCount,
  errorMessage,
  onSelectResult,
  onClear,
}: SearchPanelProps) {
  const message = statusText(status, results.length, totalCount);

  return (
    <div class="search-panel">
      <form
        class="search-panel__form"
        role="search"
        // Enter must not reload the page. Results already appear as you type,
        // so there is nothing left for a submit to do.
        onSubmit={(event) => event.preventDefault()}
      >
        <label class="search-panel__label" for="library-search-input">
          Search your feeds and articles
        </label>
        <input
          id="library-search-input"
          class="search-panel__input"
          type="search"
          value={query}
          autoComplete="off"
          placeholder="Search titles, notes and article text…"
          onInput={(event) => onQueryChange((event.currentTarget as HTMLInputElement).value)}
        />
        {query.length > 0 && (
          <button type="button" class="search-panel__clear" onClick={onClear}>
            Clear
          </button>
        )}
      </form>

      {/* Always in the DOM, even while empty: a live region that appears only
        * when it already has text is announced inconsistently, or not at all. */}
      <p class="search-panel__status" role="status" aria-live="polite">
        {message}
      </p>

      {status === "error" && errorMessage !== null && (
        <p class="search-panel__error" role="alert">
          The search could not be run. {errorMessage}
        </p>
      )}

      {results.length > 0 && (
        <ul class="search-panel__results" aria-label="Search results">
          {results.map((result) => (
            <ResultRow
              key={keyFor(result)}
              result={result}
              onSelect={() => onSelectResult(result)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
