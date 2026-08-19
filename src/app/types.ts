/**
 * View-model types for `App.tsx`'s `AppProps` test-only override (Slice 3;
 * still current as of Slice 10a, not superseded). `AppEntry` is
 * intentionally flat (feed-scoped, denormalized at render time by App.tsx)
 * so the presentational leaf components never need to know about feeds.
 * Production (`main.tsx`) never constructs these directly -- `App.tsx`
 * builds them from `services.localStore`'s real `Feed`/`Entry` domain
 * objects when no override is supplied. The Slice 3 fixture DATA that used
 * to default to these shapes (`src/app/fixtures.ts`) was retired in Slice
 * 10a; these type definitions were not, since `AppProps` still uses them.
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
