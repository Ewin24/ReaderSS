export interface Entry {
  id: string;
  feedId: string;
  guid: string | null;
  contentHash: string;
  title: string;
  link: string;
  author: string | null;
  publishedAt: string;
  fetchedAt: string;
  summaryHtml: string | null;
  contentHtml: string | null;
  hasFullContent: 0 | 1;
  read: 0 | 1;
  readChangedAt: string | null;
  starred: 0 | 1;
  starredChangedAt: string | null;
  updatedAt: string;
}

export interface CreateEntryInput {
  id: string;
  feedId: string;
  guid?: string | null;
  contentHash: string;
  title: string;
  link: string;
  author?: string | null;
  publishedAt: string;
  fetchedAt: string;
  summaryHtml?: string | null;
  contentHtml?: string | null;
  hasFullContent?: 0 | 1;
}

export function createEntry(input: CreateEntryInput): Entry {
  return {
    id: input.id,
    feedId: input.feedId,
    guid: input.guid ?? null,
    contentHash: input.contentHash,
    title: input.title,
    link: input.link,
    author: input.author ?? null,
    publishedAt: input.publishedAt,
    fetchedAt: input.fetchedAt,
    summaryHtml: input.summaryHtml ?? null,
    contentHtml: input.contentHtml ?? null,
    hasFullContent: input.hasFullContent ?? 0,
    // A freshly created entry has never been changed by a user action, so
    // both change timestamps start null — they are stamped only by
    // services/toggleRead.ts and services/toggleStar.ts (Slice 6), never here.
    read: 0,
    readChangedAt: null,
    starred: 0,
    starredChangedAt: null,
    updatedAt: input.fetchedAt,
  };
}
