/**
 * Loads the real subscribed feed list and each feed's unread count
 * (feed-subscriptions spec, "List feeds with metadata"; design.md §1) and
 * renders them through the presentational `FeedSidebar` (props in,
 * callbacks out).
 *
 * Loads its own feed list independently of `App.tsx`'s own
 * `services.localStore.listFeeds()` call (used for entry-list/selection
 * purposes) rather than receiving `feeds` as a prop -- a deliberate split,
 * not an oversight: this container also needs every feed's unread count,
 * which requires its own `listEntriesByFeed` call per feed regardless of
 * who owns the base feed list. A shared feed-list cache is a reasonable
 * follow-up, not built here to keep this container's scope focused.
 *
 * Distinguishes three states honestly (per the standing "no false empty
 * state" requirement): loading, loaded (possibly genuinely empty), and
 * load-error -- an empty list that actually means the store could not be
 * read is not information the user can act on.
 */
import { useCallback, useEffect, useState } from "preact/hooks";
import { useServices } from "../../app/providers/ServicesContext";
import { describeError } from "../../domain/errors/describeError";
import { FeedSidebar, type FeedSidebarItem } from "../components/FeedSidebar";

export interface FeedSidebarContainerProps {
  selectedFeedId: string | null;
  onSelectFeed: (feedId: string) => void;
  /**
   * `[feedListVersion, entryStateVersion]` (see `useRefreshSignals.ts`):
   * bumped by a parent to force a re-fetch of feeds and unread counts,
   * either when the feed list itself changes (a feed added/removed) or when
   * an entry's read/unread or star/unstar state changes -- previously a
   * single summed number, an opaque combined value with an implicit "both
   * are monotonic" invariant, before becoming this explicit tuple.
   * Destructured into two separate effect dependencies below, not depended
   * on by tuple identity, so a re-render that creates an
   * equal-valued-but-new array does not trigger a needless re-fetch.
   */
  refreshSignal?: readonly [feedListVersion: number, entryStateVersion: number];
  /** Called when the feed/unread-count load fails, so a parent can surface
   * it alongside other app-level errors if it wants to. This container
   * already renders its own distinct error message either way. */
  onLoadError?: (message: string) => void;
  /**
   * Called after a feed is successfully removed, so a parent can react --
   * e.g. `App.tsx` clears the current selection if the removed feed was the
   * one selected. `deleteFeed` (`idbLocalStore`, cascading entry deletion)
   * was previously unreachable from the UI; `FeedSidebar`'s own
   * confirmation step guarantees this
   * container only ever calls `deleteFeed` after the user explicitly
   * confirmed (feed-subscriptions spec, "Removal is confirmed before it
   * happens").
   */
  onFeedRemoved?: (feedId: string) => void;
}

type LoadState = "loading" | "loaded" | "error";

export function FeedSidebarContainer({
  selectedFeedId,
  onSelectFeed,
  refreshSignal,
  onLoadError,
  onFeedRemoved,
}: FeedSidebarContainerProps) {
  const services = useServices();
  const [items, setItems] = useState<FeedSidebarItem[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Distinct from `errorMessage` (a LOAD failure, which replaces the whole
  // list with an error state) -- a failed removal should not blow away an
  // otherwise successfully loaded list, just surface its own message
  // alongside it.
  const [removeErrorMessage, setRemoveErrorMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadState("loading");
    try {
      const feeds = await services.localStore.listFeeds();
      const withCounts = await Promise.all(
        feeds.map(async (feed) => {
          const feedEntries = await services.localStore.listEntriesByFeed(feed.id);
          return {
            id: feed.id,
            title: feed.title,
            folder: feed.folder,
            unreadCount: feedEntries.filter((entry) => entry.read === 0).length,
          };
        }),
      );
      setItems(withCounts);
      setLoadState("loaded");
    } catch (error) {
      setErrorMessage(describeError(error));
      setLoadState("error");
      onLoadError?.(describeError(error));
    }
  }, [services, onLoadError]);

  const [feedListVersion, entryStateVersion] = refreshSignal ?? [0, 0];

  useEffect(() => {
    void load();
    // Depends on the two DESTRUCTURED numbers, not on `refreshSignal`'s own
    // array identity -- a parent handing down a fresh-but-equal-valued
    // tuple on every render (as `App.tsx`'s `feedSidebarSignal` does) must
    // not cause a re-fetch on every unrelated re-render.
  }, [load, feedListVersion, entryStateVersion]);

  const handleRemoveFeed = useCallback(
    (feedId: string) => {
      setRemoveErrorMessage(null);
      services.localStore
        .deleteFeed(feedId)
        .then(() => {
          setItems((current) => current.filter((item) => item.id !== feedId));
          onFeedRemoved?.(feedId);
        })
        .catch((error: unknown) => {
          setRemoveErrorMessage(describeError(error));
        });
    },
    [services, onFeedRemoved],
  );

  if (loadState === "loading") {
    return (
      <nav class="feed-sidebar" aria-label="Feeds">
        <p class="feed-sidebar__loading" aria-live="polite">
          Loading feeds…
        </p>
      </nav>
    );
  }

  if (loadState === "error") {
    return (
      <nav class="feed-sidebar" aria-label="Feeds">
        <p class="feed-sidebar__error" role="alert">
          Could not load your feeds from local storage. {errorMessage}
        </p>
      </nav>
    );
  }

  return (
    <>
      {removeErrorMessage && (
        <p class="feed-sidebar__remove-error" role="alert">
          Could not remove this feed. {removeErrorMessage}
        </p>
      )}
      <FeedSidebar
        feeds={items}
        selectedFeedId={selectedFeedId}
        onSelectFeed={onSelectFeed}
        onRemoveFeed={handleRemoveFeed}
      />
    </>
  );
}
