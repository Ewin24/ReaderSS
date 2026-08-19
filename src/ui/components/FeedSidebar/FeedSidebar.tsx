export interface FeedSidebarItem {
  id: string;
  title: string;
  folder: string | null;
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
                onClick={() => onSelectFeed(feed.id)}
              >
                {feed.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}
