import { useState } from "preact/hooks";

export interface FeedSidebarItem {
  id: string;
  title: string;
  folder: string | null;
  /** feed-subscriptions spec, "List feeds with metadata".
   * Computed by whoever supplies this list -- `FeedSidebarContainer` for
   * the real, store-backed sidebar; `App.tsx` for its test-only override
   * path -- never by this presentational component itself. */
  unreadCount: number;
}

export interface FeedSidebarProps {
  feeds: FeedSidebarItem[];
  selectedFeedId: string | null;
  onSelectFeed: (feedId: string) => void;
  /**
   * Removal (feed-subscriptions spec, "Remove a feed"; task 10.18-10.19).
   * OPTIONAL, same rationale as `EntryListItem`'s toggle props: no handler
   * means no remove control renders at all, rather than a button wired to a
   * no-op. When supplied, `onRemoveFeed` is called only AFTER the user
   * confirms -- the confirmation step itself (spec: "Removal is confirmed
   * before it happens") lives here, as local, ephemeral UI state (which row
   * is mid-confirmation), not a port call, so this component stays
   * presentational.
   */
  onRemoveFeed?: (feedId: string) => void;
}

export function FeedSidebar({ feeds, selectedFeedId, onSelectFeed, onRemoveFeed }: FeedSidebarProps) {
  const [confirmingFeedId, setConfirmingFeedId] = useState<string | null>(null);

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
              {onRemoveFeed &&
                (confirmingFeedId === feed.id ? (
                  <span class="feed-sidebar__confirm-remove">
                    <span class="feed-sidebar__confirm-remove-text">
                      Remove "{feed.title}"? This deletes the feed and all of its saved entries,
                      including any starred ones. This cannot be undone.
                    </span>
                    <button
                      type="button"
                      class="feed-sidebar__confirm-remove-yes"
                      onClick={() => {
                        setConfirmingFeedId(null);
                        onRemoveFeed(feed.id);
                      }}
                    >
                      Confirm removal
                    </button>
                    <button
                      type="button"
                      class="feed-sidebar__confirm-remove-cancel"
                      onClick={() => setConfirmingFeedId(null)}
                    >
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    class="feed-sidebar__remove"
                    aria-label={`Remove ${feed.title}`}
                    onClick={() => setConfirmingFeedId(feed.id)}
                  >
                    Remove
                  </button>
                ))}
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}
