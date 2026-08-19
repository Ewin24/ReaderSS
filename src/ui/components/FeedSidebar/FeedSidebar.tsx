export interface FeedSidebarItem {
  id: string;
  title: string;
  folder: string | null;
  /** feed-subscriptions spec, "List feeds with metadata" (Slice 10a).
   * Computed by whoever supplies this list -- `FeedSidebarContainer` for
   * the real, store-backed sidebar; `App.tsx` for its test-only override
   * path -- never by this presentational component itself. */
  unreadCount: number;
}

export interface FeedSidebarProps {
  feeds: FeedSidebarItem[];
  selectedFeedId: string | null;
  onSelectFeed: (feedId: string) => void;
}

export function FeedSidebar({ feeds, selectedFeedId, onSelectFeed }: FeedSidebarProps) {
  return (
    <nav class="feed-sidebar" aria-label="Feeds">
      {feeds.length === 0 ? (
        <p class="empty-state">No feeds yet. Add a feed to get started.</p>
      ) : (
        <ul class="feed-sidebar__list">
          {feeds.map((feed) => (
            <li key={feed.id}>
              <button
                type="button"
                class="feed-sidebar__item"
                aria-current={feed.id === selectedFeedId ? "true" : undefined}
                aria-label={`${feed.title}, ${feed.unreadCount} unread`}
                onClick={() => onSelectFeed(feed.id)}
              >
                <span class="feed-sidebar__item-title" aria-hidden="true">
                  {feed.title}
                </span>
                {feed.unreadCount > 0 && (
                  <span class="feed-sidebar__item-count" aria-hidden="true">
                    {feed.unreadCount}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}
