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
}

export interface CreateFeedInput {
  id: string;
  url: string;
  normalizedUrl: string;
  title: string;
  siteUrl?: string | null;
  folder?: string | null;
  addedAt: string;
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
  };
}
