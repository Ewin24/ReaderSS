/**
 * Loads the real subscribed feed list and each feed's unread count
 * (feed-subscriptions spec, "List feeds with metadata"; design.md §1) and
 * renders them through the presentational `FeedSidebar` (props in,
 * callbacks out).
 *
 * Loads its own feed list independently of `App.tsx`'s own
 * `services.localStore.listFeeds()` call (Unit 10a's task 10.7, used for
 * entry-list/selection purposes) rather than receiving `feeds` as a prop --
 * a deliberate, task-specified split (design.md §8's Slice 10 task list),
 * not an oversight: this container also needs every feed's unread count,
 * which requires its own `listEntriesByFeed` call per feed regardless of
 * who owns the base feed list. A shared feed-list cache is a reasonable
 * follow-up, not built here to keep this unit's scope to what the task list
 * specifies.
 *
 * Distinguishes three states honestly (per the standing "no false empty
 * state" requirement carried into Unit 10a's own scope note): loading,
 * loaded (possibly genuinely empty), and load-error -- an empty list that
 * actually means the store could not be read is not information the user
 * can act on.
 */
import { useCallback, useEffect, useState } from "preact/hooks";
import { useServices } from "../../app/providers/ServicesContext";
import { FeedSidebar, type FeedSidebarItem } from "../components/FeedSidebar";

export interface FeedSidebarContainerProps {
  selectedFeedId: string | null;
  onSelectFeed: (feedId: string) => void;
  /**
   * Bumped by a parent to force a re-fetch of feeds and unread counts.
   * `App.tsx` bumps this after every store-driven entry change (read/unread,
   * star/unstar toggle) so the badge follows the store instead of only
   * reflecting reality at mount (Finding 2, Slice 10a correction round).
   * Unit 10b's add-feed and remove-feed flows are expected to bump it too.
   */
  refreshSignal?: number;
  /** Called when the feed/unread-count load fails, so a parent can surface
   * it alongside other app-level errors if it wants to. This container
   * already renders its own distinct error message either way. */
  onLoadError?: (message: string) => void;
}

type LoadState = "loading" | "loaded" | "error";

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function FeedSidebarContainer({
  selectedFeedId,
  onSelectFeed,
  refreshSignal,
  onLoadError,
}: FeedSidebarContainerProps) {
  const services = useServices();
  const [items, setItems] = useState<FeedSidebarItem[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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

  useEffect(() => {
    void load();
  }, [load, refreshSignal]);

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

  return <FeedSidebar feeds={items} selectedFeedId={selectedFeedId} onSelectFeed={onSelectFeed} />;
}
