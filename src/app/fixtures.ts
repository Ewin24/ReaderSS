import type { AppEntry, AppFeed } from "./types";

/**
 * Demo data for the Slice 3 fixture-driven shell. Slices 4-9 replace this
 * with feeds/entries sourced from services/ports; nothing in `App.tsx`
 * beyond the default prop values changes when that wiring lands.
 */
export const sampleFeeds: AppFeed[] = [
  { id: "feed-hn", title: "Hacker News", folder: null },
  { id: "feed-ars", title: "Ars Technica", folder: "Tech" },
];

export const sampleEntries: AppEntry[] = [
  {
    id: "entry-1",
    feedId: "feed-hn",
    title: "IndexedDB in practice",
    publishedAt: "2026-08-18T09:00:00.000Z",
    read: 0,
    starred: 1,
    link: "https://news.ycombinator.com/item?id=1",
    summary: null,
    content:
      "A deep dive into building a rebuildable local cache with IndexedDB, including the boolean-as-0|1 index constraint.",
  },
  {
    id: "entry-2",
    feedId: "feed-hn",
    title: "Why service workers still surprise people",
    publishedAt: "2026-08-17T09:00:00.000Z",
    read: 1,
    starred: 0,
    link: "https://news.ycombinator.com/item?id=2",
    summary: "A short recap of the most common offline-caching gotchas.",
    content: null,
  },
  {
    id: "entry-3",
    feedId: "feed-ars",
    title: "The state of self-hosted RSS readers",
    publishedAt: "2026-08-16T09:00:00.000Z",
    read: 0,
    starred: 0,
    link: "https://arstechnica.com/item/3",
    summary: null,
    content: null,
  },
];
