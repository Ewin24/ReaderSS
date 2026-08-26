/**
 * Binds `SearchPanel` to the `searchLibrary` service.
 *
 * It owns the query, the debounce, and which response is still relevant. It
 * owns NO navigation: the chosen result is handed up to whoever knows how to
 * open it (`App`), because "select this feed and this entry, and switch the
 * narrow-viewport view" is app-shell state, not search state.
 *
 * DEBOUNCED, and the reason is in `searchLibrary`'s doc comment: every search
 * re-reads the whole library, so running one per keystroke would read it five
 * times to answer one question. The wait starts again on each keystroke, so a
 * search only runs once typing pauses.
 *
 * STALE RESPONSES ARE DROPPED, not merely ignored on arrival. A slow search
 * for "ka" must never overwrite the finished results for "kafka" -- the reader
 * would see results that do not match the box they are looking at, which is
 * indistinguishable from a broken search. Each run takes a token; a response
 * whose token is no longer the current one is discarded.
 */
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { useServices } from "../../app/providers/ServicesContext";
import {
  MIN_QUERY_LENGTH,
  emptySearchOutcome,
  type SearchOutcome,
  type SearchResult,
} from "../../domain/search/librarySearch";
import { searchLibrary } from "../../services/searchLibrary";
import { SearchPanel, type SearchPanelStatus } from "../components/SearchPanel";

/** How long typing has to pause before a search runs. */
export const SEARCH_DEBOUNCE_MS = 250;

export interface SearchContainerProps {
  /** Called with the result the reader picked, for the app shell to open. */
  readonly onSelectResult: (result: SearchResult) => void;
  /**
   * `[feedListVersion, entryStateVersion]`, the same explicit tuple
   * `FeedSidebarContainer` takes (see `useRefreshSignals.ts` for why it is a
   * tuple and not a summed number). Bumped by a parent when the library itself
   * changed -- a refresh, an OPML import, a removed feed -- so results on
   * screen are re-run against the new contents instead of offering to open
   * articles that are no longer there.
   */
  readonly refreshSignal?: readonly [feedListVersion: number, entryStateVersion: number];
}

export function SearchContainer({ onSelectResult, refreshSignal }: SearchContainerProps) {
  const services = useServices();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<SearchPanelStatus>("idle");
  const [outcome, setOutcome] = useState<SearchOutcome>(() => emptySearchOutcome());
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  /** Which run is the current one; see the module note on stale responses. */
  const runRef = useRef(0);

  // Destructured, so a parent handing down a fresh-but-equal-valued tuple on
  // every render does not re-run the search on every unrelated re-render.
  const [feedListVersion, entryStateVersion] = refreshSignal ?? [0, 0];

  useEffect(() => {
    const trimmed = query.trim();

    if (trimmed.length < MIN_QUERY_LENGTH) {
      // Back to nothing said at all, rather than leaving the previous
      // query's results under an emptied box.
      runRef.current += 1;
      setStatus("idle");
      setOutcome(emptySearchOutcome(trimmed));
      setErrorMessage(null);
      return;
    }

    setStatus("searching");
    const run = (runRef.current += 1);

    const timer = setTimeout(() => {
      void searchLibrary(services, trimmed).then((result) => {
        if (run !== runRef.current) return;
        if (result.status === "error") {
          setErrorMessage(result.message);
          setStatus("error");
          return;
        }
        setOutcome(result.outcome);
        setErrorMessage(null);
        setStatus("done");
      });
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
    // `services` is a stable object for the provider's lifetime (see the
    // effects in App.tsx for the same note).
  }, [query, feedListVersion, entryStateVersion]);

  const handleClear = useCallback(() => setQuery(""), []);

  return (
    <SearchPanel
      query={query}
      onQueryChange={setQuery}
      status={status}
      results={outcome.results}
      totalCount={outcome.totalCount}
      errorMessage={errorMessage}
      onSelectResult={onSelectResult}
      onClear={handleClear}
    />
  );
}
