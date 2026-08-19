import { shortHash } from "./hash";

export interface EntryIdentityInput {
  feedId: string;
  guid?: string | null;
  id?: string | null;
  link?: string | null;
  publishedAt?: string | null;
  title?: string | null;
}

/**
 * Derives a stable, feed-scoped identity for an entry (design.md §3).
 * Prefers guid/id/link, in that order; falls back to a composite of
 * link + publishedAt + title when the feed supplies none of those.
 */
export function deriveEntryIdentity(input: EntryIdentityInput): string {
  const rawId = input.guid ?? input.id ?? input.link ?? null;
  const identitySource = rawId
    ? `${input.feedId}\0${rawId}`
    : `${input.feedId}\0${input.link ?? ""}\0${input.publishedAt ?? ""}\0${input.title ?? ""}`;
  return `${input.feedId}:${shortHash(identitySource)}`;
}

/**
 * Detects a feed whose GUIDs are unstable across fetches (design.md §3):
 * the feed has a prior baseline, none of its previously known ids survived
 * into the current payload, and every incoming id is distinct (no internal
 * collisions in the current payload).
 */
export function detectsUnstableGuid(
  previousIds: readonly string[],
  incomingIds: readonly string[],
  itemCount: number,
): boolean {
  if (previousIds.length === 0) return false;

  const previousIdSet = new Set(previousIds);
  const anyPreviousIdSurvived = incomingIds.some((id) => previousIdSet.has(id));
  if (anyPreviousIdSurvived) return false;

  const uniqueIncomingCount = new Set(incomingIds).size;
  return uniqueIncomingCount === itemCount;
}
