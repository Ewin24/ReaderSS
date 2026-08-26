import { useState } from "preact/hooks";
import { collectionNames, groupFeedsByFolder } from "../../../domain/feeds/feedGrouping";

export interface FeedSidebarItem {
  id: string;
  title: string;
  folder: string | null;
  /** Computed by whoever supplies this list -- `FeedSidebarContainer` for
   * the real, store-backed sidebar; `App.tsx` for its test-only override
   * path -- never by this presentational component itself. */
  unreadCount: number;
}

export interface FeedSidebarProps {
  feeds: FeedSidebarItem[];
  selectedFeedId: string | null;
  onSelectFeed: (feedId: string) => void;
  /**
   * Removal. OPTIONAL, same rationale as `EntryListItem`'s toggle props: no
   * handler means no remove control renders at all, rather than a button
   * wired to a no-op. When supplied, `onRemoveFeed` is called only AFTER the
   * user confirms -- removal is confirmed before it happens, and that
   * confirmation step lives here, as local, ephemeral UI state (which row is
   * mid-confirmation), not a port call, so this component stays
   * presentational.
   */
  onRemoveFeed?: (feedId: string) => void;
  /**
   * Filing a feed into a collection, or out of one (`null`). Optional for the
   * same reason as `onRemoveFeed`.
   *
   * A SELECT rather than drag and drop, and that is a decision worth stating:
   * dragging is invisible to keyboard and screen-reader users, awkward on
   * touch, and cannot be exercised in this project's test environment (jsdom
   * performs no layout and synthesizes no drag). A control that everyone can
   * operate and that is actually covered by tests beats one that looks
   * livelier and works for fewer people.
   */
  onMoveFeed?: (feedId: string, folder: string | null) => void;
}

/** Sentinel `value`s for the two picker options that are not a collection name. */
const NO_COLLECTION = "__none__";
const NEW_COLLECTION = "__new__";

/** Heading shown over feeds that are in no collection. */
export const UNGROUPED_LABEL = "No collection";

/** A stable DOM id per collection, for the heading's `aria-controls`. */
function listIdFor(label: string): string {
  return `feed-collection-${label.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase()}`;
}

interface MoveFormProps {
  feed: FeedSidebarItem;
  collections: readonly string[];
  onCancel: () => void;
  onMove: (folder: string | null) => void;
}

function MoveForm({ feed, collections, onCancel, onMove }: MoveFormProps) {
  const [choice, setChoice] = useState<string>(feed.folder ?? NO_COLLECTION);
  const [newName, setNewName] = useState("");
  const creating = choice === NEW_COLLECTION;

  function handleSubmit(event: Event) {
    event.preventDefault();
    if (creating) {
      // A blank new name would silently mean "no collection", which is not
      // what someone who just chose "New collection" is asking for.
      if (newName.trim().length === 0) return;
      onMove(newName);
      return;
    }
    onMove(choice === NO_COLLECTION ? null : choice);
  }

  return (
    <form class="feed-sidebar__move" onSubmit={handleSubmit}>
      <label class="feed-sidebar__move-label" for={`move-${feed.id}`}>
        Collection for {feed.title}
      </label>
      <select
        id={`move-${feed.id}`}
        class="feed-sidebar__move-select"
        value={choice}
        onChange={(event) => setChoice((event.currentTarget as HTMLSelectElement).value)}
      >
        <option value={NO_COLLECTION}>{UNGROUPED_LABEL}</option>
        {/* Only the collections that actually exist right now -- never a
          * fixed or invented set. */}
        {collections.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
        <option value={NEW_COLLECTION}>New collection…</option>
      </select>

      {creating && (
        <input
          type="text"
          class="feed-sidebar__move-new"
          aria-label="New collection name"
          placeholder="Collection name"
          value={newName}
          onInput={(event) => setNewName((event.currentTarget as HTMLInputElement).value)}
        />
      )}

      <span class="feed-sidebar__move-actions">
        <button type="submit" class="feed-sidebar__move-save">
          Save
        </button>
        <button type="button" class="feed-sidebar__move-cancel" onClick={onCancel}>
          Cancel
        </button>
      </span>
    </form>
  );
}

export function FeedSidebar({
  feeds,
  selectedFeedId,
  onSelectFeed,
  onRemoveFeed,
  onMoveFeed,
}: FeedSidebarProps) {
  const [confirmingFeedId, setConfirmingFeedId] = useState<string | null>(null);
  const [movingFeedId, setMovingFeedId] = useState<string | null>(null);
  /**
   * Which collections are collapsed, by name. Stores the COLLAPSED ones, not
   * the expanded ones, so a collection that appears later (imported, or
   * created by filing a feed) starts open — the default is "you can see your
   * feeds", and nothing has to be registered here to be visible.
   *
   * Session-scoped, ephemeral UI state, deliberately kept here rather than
   * persisted: it is the same kind of state as which row is mid-confirmation.
   * A reload starts with everything expanded.
   */
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());

  function toggleCollapsed(label: string) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  const groups = groupFeedsByFolder(feeds);
  const collections = collectionNames(feeds);
  // A flat subscription list -- the most common OPML shape, and where every
  // account starts -- is ONE ungrouped bucket. Heading it "No collection"
  // would label the whole sidebar with a distinction that does not exist yet.
  const showHeadings = groups.length > 1 || groups[0]?.folder !== null;

  function renderFeed(feed: FeedSidebarItem) {
    return (
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

        {onMoveFeed &&
          (movingFeedId === feed.id ? (
            <MoveForm
              feed={feed}
              collections={collections}
              onCancel={() => setMovingFeedId(null)}
              onMove={(folder) => {
                setMovingFeedId(null);
                onMoveFeed(feed.id, folder);
              }}
            />
          ) : (
            <button
              type="button"
              class="feed-sidebar__move-open"
              aria-label={`Move ${feed.title} to a collection`}
              title={`Move ${feed.title} to a collection`}
              onClick={() => {
                setConfirmingFeedId(null);
                setMovingFeedId(feed.id);
              }}
            >
              <span aria-hidden="true">🗂</span>
            </button>
          ))}

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
              title={`Remove ${feed.title}`}
              onClick={() => {
                setMovingFeedId(null);
                setConfirmingFeedId(feed.id);
              }}
            >
              <span aria-hidden="true">🗑</span>
            </button>
          ))}
      </li>
    );
  }

  return (
    <nav class="feed-sidebar" aria-label="Feeds">
      {feeds.length === 0 ? (
        <p class="empty-state">No feeds yet. Add a feed to get started.</p>
      ) : (
        groups.map((group) => {
          const label = group.folder ?? UNGROUPED_LABEL;
          const listId = listIdFor(label);
          // A flat list has no headings, so it has nothing to collapse with:
          // it can never be hidden behind a control that is not rendered.
          const isCollapsed = showHeadings && collapsed.has(label);
          const unread = group.feeds.reduce((total, feed) => total + feed.unreadCount, 0);

          return (
            <div class="feed-sidebar__group" key={label}>
              {showHeadings && (
                // Named explicitly: every child below is either a control or
                // `aria-hidden`, so name-from-content leaves the heading
                // ANONYMOUS -- and an unnamed heading is invisible to the
                // heading-navigation a screen-reader user would jump between
                // collections with. Found by a test asserting the heading by
                // name, not by inspection.
                <h2 class="feed-sidebar__group-title" aria-label={label}>
                  <button
                    type="button"
                    class="feed-sidebar__group-toggle"
                    aria-expanded={!isCollapsed}
                    aria-controls={listId}
                    // Both numbers, always, for assistive technology: the
                    // visible badge shows only one of them to keep a 220px
                    // column readable.
                    aria-label={`${label}, ${group.feeds.length} feeds, ${unread} unread`}
                    onClick={() => toggleCollapsed(label)}
                  >
                    <span class="feed-sidebar__group-caret" aria-hidden="true">
                      {isCollapsed ? "▸" : "▾"}
                    </span>
                    <span class="feed-sidebar__group-name" aria-hidden="true">
                      {label}
                    </span>
                    {/* BOTH numbers, always: feeds first, then unread.
                      *
                      * This used to be ONE number -- unread when there was
                      * any, the feed count otherwise -- which made the same
                      * badge mean two different things depending on data the
                      * reader cannot see while the collection is collapsed. A
                      * "1" next to a collection was either one feed or one
                      * unread article, and nothing on screen said which.
                      *
                      * Neither number can be dropped: collapsed is exactly
                      * when you can see neither the feeds nor their unread
                      * badges, so "what is in here" and "is there anything
                      * new" both stop being answerable. The zero is shown for
                      * the same reason -- swapping it for the other number is
                      * what created the ambiguity in the first place. `title`
                      * spells the pair out on hover; the toggle's
                      * `aria-label` already spells it out for assistive
                      * technology. */}
                    <span
                      class="feed-sidebar__group-count"
                      aria-hidden="true"
                      title={`${group.feeds.length} feeds, ${unread} unread`}
                    >
                      <span class="feed-sidebar__group-feeds">{group.feeds.length}</span>
                      <span class="feed-sidebar__group-count-sep">·</span>
                      <span class="feed-sidebar__group-unread">{unread}</span>
                    </span>
                  </button>
                </h2>
              )}
              {/* Each collection is its own list, named for assistive
                * technology, so "which collection am I in" is answerable
                * without reading back up the page. Collapsed lists stay in the
                * DOM but `hidden`, which is what keeps `aria-controls`
                * pointing at something real and takes them out of the
                * accessibility tree at the same time. */}
              <ul
                id={listId}
                class="feed-sidebar__list"
                aria-label={showHeadings ? label : undefined}
                hidden={isCollapsed}
              >
                {group.feeds.map(renderFeed)}
              </ul>
            </div>
          );
        })
      )}
    </nav>
  );
}
