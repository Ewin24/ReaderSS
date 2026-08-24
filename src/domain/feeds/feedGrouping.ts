/**
 * Grouping subscriptions into collections for display. Pure: no I/O, no DOM,
 * no store. The sidebar renders whatever this returns, in the order it
 * returns it.
 *
 * "Collection" is the word the UI uses for what OPML stores as a feed's
 * `folder`. One name in the interface, one field on disk.
 */

/** The minimum a feed must expose to be grouped. */
export interface GroupableFeed {
  readonly folder: string | null;
}

export interface FeedGroup<T extends GroupableFeed> {
  /** `null` is the ungrouped bucket, NOT a collection named "null". */
  readonly folder: string | null;
  readonly feeds: readonly T[];
}

/** Blank is not a collection name. */
function cleanFolder(folder: string | null): string | null {
  if (folder === null) return null;
  const trimmed = folder.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Every collection name currently in use, sorted, without duplicates. This is
 * what the "add to a collection" picker lists — the collections that actually
 * exist right now, never a fixed or invented set.
 *
 * Names compare exactly (after trimming): folder names arrive verbatim from
 * OPML files, and silently merging `Tech` with `tech` would rewrite what
 * another reader wrote.
 */
export function collectionNames(feeds: readonly GroupableFeed[]): string[] {
  const names = new Set<string>();
  for (const feed of feeds) {
    const folder = cleanFolder(feed.folder);
    if (folder !== null) names.add(folder);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

/**
 * Groups feeds by collection.
 *
 * ORDER, decided rather than incidental:
 * - named collections first, alphabetically — a stable, predictable place to
 *   look, which insertion order is not once feeds are added and removed;
 * - the ungrouped bucket LAST, because it is a to-do pile rather than a
 *   collection, and it is where the "add to a collection" control lives;
 * - feeds keep the order they were given inside each group, so whatever
 *   sorting the caller applied survives.
 *
 * The ungrouped bucket is omitted entirely when everything is filed. It is a
 * DISPLAY grouping only: no feed's `folder` is changed, and nothing named
 * "Uncategorized" is ever written to disk or into an OPML export.
 */
export function groupFeedsByFolder<T extends GroupableFeed>(
  feeds: readonly T[],
): FeedGroup<T>[] {
  const byFolder = new Map<string, T[]>();
  const ungrouped: T[] = [];

  for (const feed of feeds) {
    const folder = cleanFolder(feed.folder);
    if (folder === null) {
      ungrouped.push(feed);
      continue;
    }
    const bucket = byFolder.get(folder);
    if (bucket) bucket.push(feed);
    else byFolder.set(folder, [feed]);
  }

  const groups: FeedGroup<T>[] = [...byFolder.keys()]
    .sort((a, b) => a.localeCompare(b))
    .map((folder) => ({ folder, feeds: byFolder.get(folder) as T[] }));

  if (ungrouped.length > 0) {
    groups.push({ folder: null, feeds: ungrouped });
  }
  return groups;
}
