/**
 * Searching the whole local library: every subscribed feed, every note, and
 * every entry that is still stored, across all feeds -- not only the one on
 * screen.
 *
 * READS PER SEARCH, on purpose. There is no cached corpus and no index: each
 * call re-reads the feeds and entries and hands them to the pure
 * `searchCorpus`. The alternative -- keeping the whole library in memory
 * between searches -- buys speed with a copy of everything that has to be
 * invalidated correctly on every refresh, import, prune, and removal, and a
 * search that quietly returns yesterday's library is worse than one that
 * takes a moment. The caller debounces so this runs once per typed query,
 * not once per keystroke.
 *
 * It never throws. A store failure comes back as a typed `error` result, the
 * same shape the other services use, because a search box that vanishes on a
 * bad read tells the reader nothing.
 */
import { describeError } from "../domain/errors/describeError";
import {
  MIN_QUERY_LENGTH,
  emptySearchOutcome,
  searchCorpus,
  type SearchOutcome,
} from "../domain/search/librarySearch";
import type { LocalStorePort } from "../ports/LocalStorePort";

export interface SearchLibraryDeps {
  readonly localStore: LocalStorePort;
}

export interface SearchLibraryOptions {
  /** Passed straight through to `searchCorpus`. */
  readonly limit?: number;
}

export type SearchLibraryResult =
  | { readonly status: "ok"; readonly outcome: SearchOutcome }
  | { readonly status: "error"; readonly query: string; readonly message: string };

export async function searchLibrary(
  deps: SearchLibraryDeps,
  query: string,
  options: SearchLibraryOptions = {},
): Promise<SearchLibraryResult> {
  const trimmed = query.trim();
  // Short-circuited BEFORE the store read: a query that cannot match anything
  // must not cost a full read of the library on the way to an empty answer.
  if (trimmed.length < MIN_QUERY_LENGTH) {
    return { status: "ok", outcome: emptySearchOutcome(trimmed) };
  }

  try {
    // Newest-first, and `searchCorpus` preserves the order it is given, so
    // recent articles come out on top of the results for free.
    const [feeds, entries] = await Promise.all([
      deps.localStore.listFeeds(),
      deps.localStore.listEntriesByPublished(),
    ]);

    const outcome = searchCorpus(
      {
        feeds: feeds.map((feed) => ({ id: feed.id, title: feed.title, note: feed.note })),
        entries: entries.map((entry) => ({
          id: entry.id,
          feedId: entry.feedId,
          title: entry.title,
          publishedAt: entry.publishedAt,
          // The same body the reading pane shows: full content when the feed
          // sends it, the summary otherwise. Searching one and displaying the
          // other would produce matches the reader cannot find on the page.
          bodyHtml: entry.contentHtml ?? entry.summaryHtml,
        })),
      },
      trimmed,
      options,
    );

    return { status: "ok", outcome };
  } catch (error: unknown) {
    return { status: "error", query: trimmed, message: describeError(error) };
  }
}
