export interface FeedError {
  code: string;
  at: string;
}

export interface Feed {
  id: string;
  url: string;
  normalizedUrl: string;
  title: string;
  siteUrl: string | null;
  folder: string | null;
  etag: string | null;
  lastModified: string | null;
  lastFetchedAt: string | null;
  lastSuccessAt: string | null;
  lastError: FeedError | null;
  addedAt: string;
  unstableGuid: 0 | 1;
  /**
   * Your own note about this feed -- why you subscribed, what you want out of
   * it, what to ignore. Written by you, never by the feed: nothing in the
   * fetch/parse path ever sets it, so a refresh can never overwrite it.
   *
   * Round-trips through OPML as the standard `description` attribute, which
   * is what makes it survive an export/import cycle and travel to other
   * readers.
   *
   * Feeds stored before this field existed have no `note` on disk. The store
   * adapter fills it in as `null` on read (see `idbLocalStore.ts`), so this
   * type stays true without a schema migration.
   */
  note: string | null;
}

export interface CreateFeedInput {
  id: string;
  url: string;
  normalizedUrl: string;
  title: string;
  siteUrl?: string | null;
  folder?: string | null;
  addedAt: string;
  note?: string | null;
}

export function createFeed(input: CreateFeedInput): Feed {
  return {
    id: input.id,
    url: input.url,
    normalizedUrl: input.normalizedUrl,
    title: input.title,
    siteUrl: input.siteUrl ?? null,
    folder: input.folder ?? null,
    etag: null,
    lastModified: null,
    lastFetchedAt: null,
    lastSuccessAt: null,
    lastError: null,
    addedAt: input.addedAt,
    unstableGuid: 0,
    note: input.note ?? null,
  };
}
