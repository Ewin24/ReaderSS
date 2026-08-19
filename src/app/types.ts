/**
 * Fixture-shaped view types for the Slice 3 app shell. `AppEntry` is
 * intentionally flat (feed-scoped, denormalized at render time by App.tsx)
 * so the presentational leaf components never need to know about feeds.
 * Slices 4-9 replace these with data sourced from services/ports; the shape
 * is kept close to `domain/models` so that wiring is additive, not a rewrite.
 */
export interface AppFeed {
  id: string;
  title: string;
  folder: string | null;
}

export interface AppEntry {
  id: string;
  feedId: string;
  title: string;
  publishedAt: string;
  read: 0 | 1;
  starred: 0 | 1;
  link: string;
  summary: string | null;
  content: string | null;
}
