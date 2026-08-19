/**
 * App shell layout (Slice 3). Fixture-driven presentational wiring only:
 * feeds/entries are passed in (defaulting to demo fixtures) and rendered
 * through the four presentational components. Real data wiring via
 * services/containers lands in Slices 4-9; this component's shape does not
 * change, only where `feeds`/`entries` come from.
 */
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { FeedSidebar } from "../ui/components/FeedSidebar";
import { EntryList } from "../ui/components/EntryList";
import { ReadingPane, type ReadingPaneEntry } from "../ui/components/ReadingPane";
import { DESKTOP_QUERY, useMediaQuery } from "./useMediaQuery";
import { sampleEntries, sampleFeeds } from "./fixtures";
import type { AppEntry, AppFeed } from "./types";
import "../styles/grid.css";

export interface AppProps {
  feeds?: AppFeed[];
  entries?: AppEntry[];
}

type MobileView = "list" | "reading";

export function App({ feeds = sampleFeeds, entries = sampleEntries }: AppProps = {}) {
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const [selectedFeedId, setSelectedFeedId] = useState<string | null>(
    feeds[0]?.id ?? null,
  );
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<MobileView>("list");
  const readingHeadingRef = useRef<HTMLHeadingElement>(null);
  const entryListRef = useRef<HTMLUListElement>(null);
  const previousMobileViewRef = useRef<MobileView>(mobileView);

  const feedEntries = useMemo(
    () => entries.filter((entry) => entry.feedId === selectedFeedId),
    [entries, selectedFeedId],
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

  const readingPaneEntry: ReadingPaneEntry | null = selectedEntry
    ? {
        id: selectedEntry.id,
        title: selectedEntry.title,
        feedTitle: selectedFeed?.title ?? "Unknown feed",
        publishedAt: selectedEntry.publishedAt,
        link: selectedEntry.link,
        summary: selectedEntry.summary,
        content: selectedEntry.content,
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

  // On a narrow viewport, only one of EntryList/ReadingPane is mounted at a
  // time (design.md's responsive-layout requirement), and unmounting the
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

  return (
    <div class="app-shell">
      <FeedSidebar
        feeds={feeds}
        selectedFeedId={selectedFeedId}
        onSelectFeed={handleSelectFeed}
      />
      {showList && (
        <EntryList
          entries={entryListItems}
          selectedEntryId={selectedEntryId}
          onSelectEntry={handleSelectEntry}
          listRef={entryListRef}
          emptyMessage={
            selectedFeedId === null
              ? "Add a feed to see its entries."
              : "This feed has no entries yet."
          }
        />
      )}
      {showReadingPane && (
        <ReadingPane
          entry={readingPaneEntry}
          onBack={!isDesktop ? handleBack : undefined}
          headingRef={readingHeadingRef}
        />
      )}
    </div>
  );
}
