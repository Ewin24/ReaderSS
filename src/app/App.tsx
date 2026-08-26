/**
 * App shell layout and composition. `feeds`/`entries` stay as an OPTIONAL
 * test-only override (`AppProps`) -- when supplied, `App` renders exactly
 * that data synchronously, which is what every layout/focus/selection/
 * empty-state test still exercises. Production (`main.tsx`) never passes
 * them: with no override, `App` loads feeds and the selected feed's
 * entries from `services.localStore` on mount and on selection change.
 *
 * Regardless of data source, `EntryListContainer`/`ReadingPaneContainer`
 * render the list and reading pane, so every read/unread and star/unstar
 * toggle always routes through the real `toggleRead`/`toggleStar` services
 * -- even in override/test mode, which is why every `App` test now needs a
 * `ServicesProvider` ancestor.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { FeedSidebar, type FeedSidebarItem } from "../ui/components/FeedSidebar";
import { EntryListContainer } from "../ui/containers/EntryListContainer";
import { ReadingPaneContainer } from "../ui/containers/ReadingPaneContainer";
import { FeedSidebarContainer } from "../ui/containers/FeedSidebarContainer";
import { AddFeedContainer } from "../ui/containers/AddFeedContainer";
import { OpmlContainer } from "../ui/containers/OpmlContainer";
import { FeedNoteContainer } from "../ui/containers/FeedNoteContainer";
import { RefreshContainer } from "../ui/containers/RefreshContainer";
import { SearchContainer } from "../ui/containers/SearchContainer";
import type { SearchResult } from "../domain/search/librarySearch";
import type { ReadingPaneEntry } from "../ui/components/ReadingPane";
import { DESKTOP_QUERY, useMediaQuery } from "./useMediaQuery";
import { useRefreshSignals } from "./useRefreshSignals";
import { useServices } from "./providers/ServicesContext";
import { useVisualSettings } from "./providers/SettingsProvider";
import { SettingsPanel } from "../ui/components/SettingsPanel";
import { describeError } from "../domain/errors/describeError";
import {
  PAGINATED_PAGE_SIZE,
  clampPage,
  pageCount,
  paginate,
} from "../domain/visual/pagination";
import {
  contentPageCount,
  splitTopLevelHtmlBlocks,
} from "../domain/visual/contentPagination";
import { shortHash } from "../domain/identity/hash";
import { useSanitizer } from "../ui/components/SafeHtml";
import { useViewportPageSize } from "./useViewportPageSize";
import type { AppEntry, AppFeed } from "./types";
import "../styles/grid.css";
import "../styles/visual.css";
import "../styles/ui.css";

export interface AppProps {
  /** Test-only override: when supplied, `App` renders exactly this data
   * instead of loading from `services.localStore`. Production callers
   * (`main.tsx`) never pass these -- the fixture defaults
   * (`src/app/fixtures.ts`) are no longer the runtime default. */
  feeds?: AppFeed[];
  entries?: AppEntry[];
}

type MobileView = "list" | "reading";

interface LoadState {
  readonly status: "loading" | "loaded" | "error";
  readonly message?: string;
}

const LOADED: LoadState = { status: "loaded" };

function toAppFeed(feed: {
  id: string;
  title: string;
  folder: string | null;
  note: string | null;
}): AppFeed {
  return { id: feed.id, title: feed.title, folder: feed.folder, note: feed.note };
}

function toAppEntry(entry: {
  id: string;
  feedId: string;
  title: string;
  publishedAt: string;
  read: 0 | 1;
  starred: 0 | 1;
  link: string;
  summaryHtml: string | null;
  contentHtml: string | null;
}): AppEntry {
  return {
    id: entry.id,
    feedId: entry.feedId,
    title: entry.title,
    publishedAt: entry.publishedAt,
    read: entry.read,
    starred: entry.starred,
    link: entry.link,
    summary: entry.summaryHtml,
    content: entry.contentHtml,
  };
}

export function App({ feeds: feedsOverride, entries: entriesOverride }: AppProps = {}) {
  const services = useServices();
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const usingOverride = feedsOverride !== undefined;
  const { settings, updateSettings } = useVisualSettings();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [listPage, setListPage] = useState(1);
  const [contentPage, setContentPage] = useState(1);
  const paginated = settings.navMode === "paginated";
  // The same single sanitize choke point SafeHtml uses (DOMPurify), needed
  // here only to derive the content page count from the clean body.
  const sanitize = useSanitizer();
  // Viewport-adaptive content page size: number of blocks that fit in the
  // reading-pane height. Only active when navMode="paginated". Falls back to
  // the domain constant (6) in test environments without ResizeObserver.
  const contentBlocksPerPage = useViewportPageSize();

  const [storeFeeds, setStoreFeeds] = useState<AppFeed[]>([]);
  const [storeEntries, setStoreEntries] = useState<AppEntry[]>([]);
  const [feedsState, setFeedsState] = useState<LoadState>(usingOverride ? LOADED : { status: "loading" });
  const [entriesState, setEntriesState] = useState<LoadState>(LOADED);
  const [toggleErrorMessage, setToggleErrorMessage] = useState<string | null>(null);
  // The three refresh-signal counters (feed list changed, an entry's state
  // changed, a manual refresh completed) and their bump handlers used to
  // live inline here as three separate `useState`s, and
  // `FeedSidebarContainer`'s prop was an opaque arithmetic sum of two of
  // them. See `useRefreshSignals.ts` for the full rationale.
  const {
    feedListVersion,
    entriesVersion,
    feedSidebarSignal,
    bumpFeedList,
    bumpEntryState,
    bumpEntries,
  } = useRefreshSignals();

  const feeds = usingOverride ? (feedsOverride as AppFeed[]) : storeFeeds;
  const allEntries = usingOverride ? (entriesOverride as AppEntry[]) : storeEntries;

  const [selectedFeedId, setSelectedFeedId] = useState<string | null>(
    usingOverride ? (feedsOverride as AppFeed[])[0]?.id ?? null : null,
  );
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<MobileView>("list");
  const readingHeadingRef = useRef<HTMLHeadingElement>(null);
  const entryListRef = useRef<HTMLUListElement>(null);
  const previousMobileViewRef = useRef<MobileView>(mobileView);

  // Feeds load (store-driven mode only): runs once on mount. The override
  // path never touches the store for its OWN data, but toggle clicks still
  // route through the real services regardless (see the container wiring
  // below), which is why every test still needs a ServicesProvider.
  useEffect(() => {
    if (usingOverride) return;
    let cancelled = false;
    setFeedsState({ status: "loading" });
    services.localStore
      .listFeeds()
      .then((loadedFeeds) => {
        if (cancelled) return;
        setStoreFeeds(loadedFeeds.map(toAppFeed));
        setFeedsState(LOADED);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setFeedsState({ status: "error", message: describeError(error) });
      });
    return () => {
      cancelled = true;
    };
    // `services` is intentionally not a dependency: it comes from
    // `ServicesContext` and is expected to be a stable object identity for
    // the lifetime of the provider (constructed once by `buildServices()`
    // in `main.tsx`). `feedListVersion` IS a dependency: it is what makes an
    // added or removed feed show up here.
  }, [usingOverride, feedListVersion]);

  // Default feed selection once the store's feed list has loaded (mirrors
  // the override path's lazy-initializer default of "first feed").
  useEffect(() => {
    if (usingOverride || feedsState.status !== "loaded") return;
    setSelectedFeedId((current) => current ?? storeFeeds[0]?.id ?? null);
  }, [usingOverride, feedsState.status, storeFeeds]);

  // Entries load for the selected feed (store-driven mode only): re-runs on
  // every selection change.
  useEffect(() => {
    if (usingOverride) return;
    if (selectedFeedId === null) {
      setStoreEntries([]);
      setEntriesState(LOADED);
      return;
    }
    let cancelled = false;
    setEntriesState({ status: "loading" });
    services.localStore
      .listEntriesByFeedPublished(selectedFeedId)
      .then((loadedEntries) => {
        if (cancelled) return;
        setStoreEntries(loadedEntries.map(toAppEntry));
        setEntriesState(LOADED);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setEntriesState({ status: "error", message: describeError(error) });
      });
    return () => {
      cancelled = true;
    };
    // See the feeds-load effect above for why `services` is not listed.
    // `entriesVersion` IS a dependency: it is what makes a manual refresh's
    // newly fetched entries show up here, since a refresh does
    // not itself change `selectedFeedId`.
  }, [usingOverride, selectedFeedId, entriesVersion]);

  const feedEntries = useMemo(
    () =>
      usingOverride
        ? allEntries.filter((entry) => entry.feedId === selectedFeedId)
        : allEntries,
    [allEntries, selectedFeedId, usingOverride],
  );

  const selectedEntry = useMemo(
    () => feedEntries.find((entry) => entry.id === selectedEntryId) ?? null,
    [feedEntries, selectedEntryId],
  );

  const selectedFeed = useMemo(
    () => feeds.find((feed) => feed.id === selectedFeedId) ?? null,
    [feeds, selectedFeedId],
  );

  const entryListItems = useMemo(
    () =>
      feedEntries.map((entry) => ({
        id: entry.id,
        title: entry.title,
        feedTitle: selectedFeed?.title ?? "Unknown feed",
        publishedAt: entry.publishedAt,
        read: entry.read,
        starred: entry.starred,
      })),
    [feedEntries, selectedFeed],
  );

  // Reset the pagination page whenever the data shown or the navigation mode
  // changes (design D5: "page state in App, reset on feed/entries/navMode
  // change"). A ref guards against Preact re-running an effect whose deps are
  // referentially equal, so advancing pages (which changes none of these) can
  // never be clobbered by a spurious reset.
  /**
   * Remembered list page per feed: switching to another feed and coming back
   * lands where you left off instead of on page 1.
   *
   * Session-scoped and in-memory ON PURPOSE -- a reload starts fresh. A page
   * NUMBER is only meaningful against the exact list it was taken from, and
   * that list is rebuilt from the store on every load (and pruned by the
   * retention policy), so persisting the number would restore a position
   * that may no longer point at the same entries.
   */
  const listPageByFeedRef = useRef(new Map<string | null, number>());

  const prevResetRef = useRef<{
    feedId: string | null;
    entries: readonly AppEntry[] | null;
    paginated: boolean;
  } | null>(null);
  const prevReset = prevResetRef.current;
  useEffect(() => {
    if (
      prevReset &&
      prevReset.feedId === selectedFeedId &&
      prevReset.entries === allEntries &&
      prevReset.paginated === paginated
    ) {
      return;
    }
    // Only the selected feed changed: the underlying list is the same one the
    // remembered page numbers were taken from, so restoring is safe.
    const feedChangedOnly =
      prevReset !== null &&
      prevReset.entries === allEntries &&
      prevReset.paginated === paginated &&
      prevReset.feedId !== selectedFeedId;
    prevResetRef.current = { feedId: selectedFeedId, entries: allEntries, paginated };

    if (feedChangedOnly) {
      setListPage(listPageByFeedRef.current.get(selectedFeedId) ?? 1);
      return;
    }
    // The data itself or the navigation mode changed, so a remembered page
    // number no longer describes the same list -- drop it rather than restore
    // a position that may not exist any more.
    listPageByFeedRef.current.clear();
    setListPage(1);
  }, [selectedFeedId, allEntries, paginated]);

  const totalPageCount = pageCount(entryListItems);
  const currentPage = clampPage(listPage, totalPageCount);

  /** Single writer for the list page, so every move is also remembered. */
  const goToListPage = useCallback(
    (next: number) => {
      const target = clampPage(next, totalPageCount);
      listPageByFeedRef.current.set(selectedFeedId, target);
      setListPage(target);
    },
    [totalPageCount, selectedFeedId],
  );
  /**
   * The article a search result asked for, waiting for its feed's entries to
   * arrive.
   *
   * Opening a result is a two-step move: selecting the feed starts a load, and
   * only once that load lands does the entry exist in a list that can be paged
   * to. Without this, picking the fortieth match of a feed would select the
   * right article and leave the list sitting on page one, with the reader
   * looking at a reading pane whose entry is nowhere in the list beside it.
   */
  const pendingSearchEntryRef = useRef<{ feedId: string; entryId: string } | null>(null);

  useEffect(() => {
    const pending = pendingSearchEntryRef.current;
    if (pending === null) return;
    if (pending.feedId !== selectedFeedId) {
      // Something else navigated in the meantime; that wins.
      pendingSearchEntryRef.current = null;
      return;
    }
    const index = entryListItems.findIndex((item) => item.id === pending.entryId);
    // NOT found is not a failure yet: until this feed's entries land, the list
    // still holds the previous feed's. Held rather than dropped, so the jump
    // happens on the render where the entries actually arrive.
    if (index < 0) return;
    pendingSearchEntryRef.current = null;
    goToListPage(Math.floor(index / PAGINATED_PAGE_SIZE) + 1);
    // Declared AFTER the page-reset effect above on purpose: loading a feed's
    // entries makes that effect reset the list to page 1, and effects run in
    // declaration order, so this one has the last word.
  }, [entryListItems, selectedFeedId, goToListPage]);

  const visibleEntryItems = paginated ? paginate(entryListItems, currentPage) : entryListItems;

  // Content pagination (navMode=paginated): the reading pane's body is split
  // into pages. `contentBody` is what `ReadingPane` renders (`content` else
  // `summary`); `contentHash` keys the reset effect so opening a different
  // entry or a changed body lands on page 1. The page count is derived from
  // the CLEAN body (single sanitize choke point, same cacheKey ReadingPane
  // uses so the LRU memo dedupes) -- we never split raw feed HTML here.
  const contentBody = selectedEntry ? (selectedEntry.content ?? selectedEntry.summary) : null;
  const contentHash = contentBody ? shortHash(contentBody) : null;
  const contentPageCountValue = useMemo(() => {
    if (!paginated || contentBody === null || contentHash === null || selectedEntry === null) {
      return 1;
    }
    const cleanBody = sanitize(contentBody, `${selectedEntry.id}:${contentHash}`);
    return contentPageCount(splitTopLevelHtmlBlocks(cleanBody), contentBlocksPerPage);
  }, [paginated, contentBody, contentHash, selectedEntry, sanitize, contentBlocksPerPage]);

  // Reset the content page whenever the selected entry or its content changes
  // (mirrors the list's ref-guarded reset, D5). A ref guards against Preact
  // re-running an effect whose deps are referentially equal, so advancing
  // content pages can never be clobbered by a spurious reset. Note: the
  // navigation mode (`paginated`) is deliberately NOT a dependency -- it flips
  // once when the settings load asynchronously on mount, and depending on it
  // would race a user's page advance against that initial load, silently
  // reverting it to page 1.
  const prevContentResetRef = useRef<{
    entryId: string | null;
    contentHash: string | null;
  } | null>(null);
  const prevContentReset = prevContentResetRef.current;

  /**
   * Remembered content page per entry, keyed by entry id AND body hash: an
   * entry whose content actually changed (a corrected post re-fetched from
   * the feed) is a different document, so its old page number is dropped
   * rather than pointing into text that no longer exists. Same session-only
   * rationale as `listPageByFeedRef`.
   */
  const contentPageByEntryRef = useRef(new Map<string, number>());
  const contentMemoKey =
    selectedEntryId !== null && contentHash !== null ? `${selectedEntryId}:${contentHash}` : null;

  useEffect(() => {
    if (
      prevContentReset &&
      prevContentReset.entryId === selectedEntryId &&
      prevContentReset.contentHash === contentHash
    ) {
      return;
    }
    prevContentResetRef.current = { entryId: selectedEntryId, contentHash };
    setContentPage(
      contentMemoKey === null ? 1 : (contentPageByEntryRef.current.get(contentMemoKey) ?? 1),
    );
  }, [selectedEntryId, contentHash, contentMemoKey]);

  const contentPaginationActive = paginated && contentPageCountValue > 1;
  const clampedContentPage = clampPage(contentPage, contentPageCountValue);

  /** Single writer for the content page, so every move is also remembered. */
  const goToContentPage = useCallback(
    (next: number) => {
      const target = clampPage(next, contentPageCountValue);
      if (contentMemoKey !== null) {
        contentPageByEntryRef.current.set(contentMemoKey, target);
      }
      setContentPage(target);
    },
    [contentPageCountValue, contentMemoKey],
  );

  // Only used in override/test mode: the store-driven sidebar renders
  // through `FeedSidebarContainer` below instead, which loads its own feed
  // list and unread counts directly from `services.localStore`.
  const overrideFeedSidebarItems: FeedSidebarItem[] = useMemo(
    () =>
      feeds.map((feed) => ({
        id: feed.id,
        title: feed.title,
        folder: feed.folder,
        unreadCount: allEntries.filter((entry) => entry.feedId === feed.id && entry.read === 0)
          .length,
      })),
    [feeds, allEntries],
  );

  const readingPaneEntry: ReadingPaneEntry | null = selectedEntry
    ? {
        id: selectedEntry.id,
        title: selectedEntry.title,
        feedTitle: selectedFeed?.title ?? "Unknown feed",
        publishedAt: selectedEntry.publishedAt,
        link: selectedEntry.link,
        summary: selectedEntry.summary,
        content: selectedEntry.content,
        read: selectedEntry.read,
        starred: selectedEntry.starred,
      }
    : null;

  function handleSelectFeed(feedId: string) {
    setSelectedFeedId(feedId);
    setSelectedEntryId(null);
    setMobileView("list");
  }

  function handleSelectEntry(entryId: string) {
    setSelectedEntryId(entryId);
    setMobileView("reading");
  }

  function handleBack() {
    setMobileView("list");
  }

  /**
   * Opens whatever a search result points at. This is the "take me to where
   * you found it" half of the search: a result is only useful if it lands you
   * on the thing itself.
   *
   * A FEED result behaves exactly like clicking that feed in the sidebar. An
   * ARTICLE result selects its feed AND the article -- possibly a feed other
   * than the one being read, which is the whole point of searching the library
   * rather than the open list -- and opens the reading pane on a narrow
   * viewport. The list page catches up through `pendingSearchEntryRef` above,
   * once that feed's entries have loaded.
   */
  const handleSearchResult = useCallback((result: SearchResult) => {
    if (result.kind === "feed") {
      pendingSearchEntryRef.current = null;
      setSelectedFeedId(result.feedId);
      setSelectedEntryId(null);
      setMobileView("list");
      return;
    }
    pendingSearchEntryRef.current = { feedId: result.feedId, entryId: result.entryId };
    setSelectedFeedId(result.feedId);
    setSelectedEntryId(result.entryId);
    setMobileView("reading");
  }, []);

  // Refreshes one entry from the store after its toggle write settles, so
  // the store-driven list/pane reflect the new read/starred state. A no-op
  // in override mode: `allEntries` there is a static test prop, not state
  // this component owns, so there is nothing to update in place -- the
  // click still reaches the real service and `putEntry` (asserted by the
  // container-level tests), it just does not re-render the override's
  // fixed props.
  const handleEntryChanged = useCallback(
    (entryId: string) => {
      if (usingOverride) return;
      services.localStore.getEntry(entryId).then((entry) => {
        if (entry === undefined) return;
        setStoreEntries((current) =>
          current.map((existing) => (existing.id === entryId ? toAppEntry(entry) : existing)),
        );
        bumpEntryState();
      });
    },
    [usingOverride, services, bumpEntryState],
  );

  const handleToggleError = useCallback((_entryId: string, message: string) => {
    setToggleErrorMessage(message);
  }, []);

  /**
   * The feed list is the single owner of a note's value; `FeedNoteContainer`
   * reports the saved text back here instead of keeping its own copy, so the
   * two can never drift.
   *
   * The override path is left alone on purpose: it renders exactly the data a
   * test handed in, and quietly rewriting that data would make the override
   * lie about what it was given.
   */
  const handleNoteSaved = useCallback(
    (feedId: string, note: string | null) => {
      if (usingOverride) return;
      setStoreFeeds((current) =>
        current.map((feed) => (feed.id === feedId ? { ...feed, note } : feed)),
      );
    },
    [usingOverride],
  );

  /** Keeps App's own copy of the feed list in step when the sidebar files a
   * feed into a collection. Same single-owner rule as `handleNoteSaved`. */
  const handleFeedMoved = useCallback(
    (feedId: string, folder: string | null) => {
      if (usingOverride) return;
      setStoreFeeds((current) =>
        current.map((feed) => (feed.id === feedId ? { ...feed, folder } : feed)),
      );
    },
    [usingOverride],
  );

  /**
   * An OPML import adds feeds in bulk. Unlike a single subscribe it does NOT
   * select anything: picking one of forty imported feeds for the user would be
   * an arbitrary jump away from wherever they were.
   */
  const handleFeedsImported = useCallback(() => {
    bumpFeedList();
    bumpEntries();
  }, [bumpFeedList, bumpEntries]);

  // A newly subscribed feed must appear in the feed list without a page
  // reload, and is also selected immediately, so its entries are visible
  // without an extra click.
  const handleFeedSubscribed = useCallback(
    (feedId: string) => {
      bumpFeedList();
      setSelectedFeedId(feedId);
      setSelectedEntryId(null);
    },
    [bumpFeedList],
  );

  // If the removed feed was the selected one, clear the
  // selection -- the entries-load effect above then naturally clears
  // `storeEntries` for a null `selectedFeedId`.
  const handleFeedRemoved = useCallback(
    (feedId: string) => {
      bumpFeedList();
      setSelectedFeedId((current) => (current === feedId ? null : current));
    },
    [bumpFeedList],
  );

  // A refresh does not add/remove feeds, only fetches new
  // content for existing ones, so only the entries/entry-state signals are
  // bumped -- never `bumpFeedList`, which would needlessly reload
  // `storeFeeds` (feed titles/folders do not change on refresh).
  const handleRefreshCompleted = useCallback(() => {
    bumpEntries();
    bumpEntryState();
  }, [bumpEntries, bumpEntryState]);

  // On a narrow viewport, only one of EntryList/ReadingPane is mounted at a
  // time, per the responsive-layout requirement, and unmounting the
  // focused element resets browser focus to <body> with no recovery - a
  // keyboard/screen-reader user would have to tab from the top of the page
  // on every navigation. On desktop both panes stay mounted, so there is
  // nothing to restore focus to.
  useEffect(() => {
    const previous = previousMobileViewRef.current;
    previousMobileViewRef.current = mobileView;

    if (isDesktop || previous === mobileView) {
      return;
    }

    if (mobileView === "reading") {
      readingHeadingRef.current?.focus();
    } else {
      const selectedItem = entryListRef.current?.querySelector<HTMLButtonElement>(
        '[aria-current="true"]',
      );
      (selectedItem ?? entryListRef.current)?.focus();
    }
  }, [mobileView, isDesktop]);

  const showList = isDesktop || mobileView === "list";
  const showReadingPane = isDesktop || mobileView === "reading";

  const entryListArea = (() => {
    if (!usingOverride && feedsState.status === "loading") {
      return (
        <p class="entry-list entry-list--loading" aria-live="polite">
          Loading your feeds…
        </p>
      );
    }
    if (!usingOverride && feedsState.status === "error") {
      return (
        <p class="entry-list entry-list--error" role="alert">
          Could not load your feeds from local storage. {feedsState.message}
        </p>
      );
    }
    if (!usingOverride && selectedFeedId !== null && entriesState.status === "loading") {
      return (
        <p class="entry-list entry-list--loading" aria-live="polite">
          Loading entries…
        </p>
      );
    }
    if (!usingOverride && selectedFeedId !== null && entriesState.status === "error") {
      return (
        <p class="entry-list entry-list--error" role="alert">
          Could not load this feed's entries from local storage. {entriesState.message}
        </p>
      );
    }
    return (
      <EntryListContainer
        entries={visibleEntryItems}
        selectedEntryId={selectedEntryId}
        onSelectEntry={handleSelectEntry}
        listRef={entryListRef}
        emptyMessage={
          selectedFeedId === null
            ? "Add a feed to see its entries."
            : "This feed has no entries yet."
        }
        onEntryChanged={handleEntryChanged}
        onToggleError={handleToggleError}
        page={paginated ? currentPage : undefined}
        pageCount={paginated ? totalPageCount : undefined}
        onPrevPage={paginated ? () => goToListPage(currentPage - 1) : undefined}
        onNextPage={paginated ? () => goToListPage(currentPage + 1) : undefined}
        // NO scroll-to-advance. Reaching the bottom of a page used to jump to
        // the next one, which reads as the page moving out from under you --
        // scrolling is how you read a page that does not quite fit, not a
        // request to leave it. Page changes are explicit (Prev/Next) only.
        onScrollEnd={undefined}
      />
    );
  })();

  return (
    <div class="app-shell">
      {toggleErrorMessage && (
        <p class="app-shell__toggle-error" role="alert">
          {toggleErrorMessage}
        </p>
      )}
      <div class="app-shell__actions">
        <AddFeedContainer onSubscribed={handleFeedSubscribed} />
        <RefreshContainer onRefreshed={handleRefreshCompleted} />
        <button
          type="button"
          class="app-shell__settings-toggle"
          aria-expanded={settingsOpen}
          aria-controls="app-settings-panel"
          onClick={() => setSettingsOpen((open) => !open)}
        >
          {settingsOpen ? "Close settings" : "Settings"}
        </button>
      </div>
      {/* Its own full-width row (see grid.css's placement contract). Rendered
        * in override/test mode too: like the read/star toggles, it routes
        * through the real services rather than the override's fixed props, and
        * it reads nothing at all until someone types. */}
      <div class="app-shell__search">
        <SearchContainer
          onSelectResult={handleSearchResult}
          refreshSignal={feedSidebarSignal}
        />
      </div>
      <div
        id="app-settings-panel"
        class="app-shell__settings"
        hidden={!settingsOpen}
      >
        <SettingsPanel settings={settings} onUpdateSettings={updateSettings} />
        {/* Lives inside the settings row rather than the actions bar: an
          * import is an occasional, deliberate act, not a per-session control,
          * and putting it here keeps it out of the way without hiding it. It
          * is a child of this row's div, NOT of `.app-shell` -- adding a
          * direct `.app-shell` child would need its own grid area (see
          * grid.css's placement contract and `grid.test.ts`'s guard). */}
        <OpmlContainer onImported={handleFeedsImported} />
      </div>
      {/* Its own full-width row (see grid.css's placement contract): the note
        * is about the whole feed, so it belongs above the panes rather than
        * inside the list or the reading pane. Renders nothing at all when no
        * feed is selected, and the row is `auto`, so it costs no space. */}
      <div class="app-shell__feed-note">
        <FeedNoteContainer
          feedId={selectedFeedId}
          feedTitle={selectedFeed?.title ?? null}
          note={selectedFeed?.note ?? null}
          onNoteSaved={handleNoteSaved}
        />
      </div>
      {usingOverride ? (
        <FeedSidebar
          feeds={overrideFeedSidebarItems}
          selectedFeedId={selectedFeedId}
          onSelectFeed={handleSelectFeed}
        />
      ) : (
        <FeedSidebarContainer
          selectedFeedId={selectedFeedId}
          onSelectFeed={handleSelectFeed}
          refreshSignal={feedSidebarSignal}
          onFeedRemoved={handleFeedRemoved}
          onFeedMoved={handleFeedMoved}
        />
      )}
      {showList && entryListArea}
      {showReadingPane && (
        <ReadingPaneContainer
          entry={readingPaneEntry}
          onBack={!isDesktop ? handleBack : undefined}
          headingRef={readingHeadingRef}
          onEntryChanged={handleEntryChanged}
          onToggleError={handleToggleError}
          page={contentPaginationActive ? clampedContentPage : undefined}
          pageCount={contentPaginationActive ? contentPageCountValue : undefined}
          // Same size used to derive `contentPageCountValue` above: counting
          // and slicing must agree, or the pane renders the wrong slice and
          // the trailing pages come out empty.
          blocksPerPage={contentPaginationActive ? contentBlocksPerPage : undefined}
          onPrevPage={
            contentPaginationActive ? () => goToContentPage(clampedContentPage - 1) : undefined
          }
          onNextPage={
            contentPaginationActive ? () => goToContentPage(clampedContentPage + 1) : undefined
          }
          // NO scroll-to-advance -- same rationale as the entry list above.
          onScrollEnd={undefined}
        />
      )}
    </div>
  );
}
