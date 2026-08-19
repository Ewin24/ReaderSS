export interface RetentionPolicy {
  /** Never prune an unread entry younger than this, in days. */
  neverPruneWindowDays: number;
  /** Delete a read, unstarred entry once it is older than this, in days. */
  ageCapDays: number;
  /** Keep at most this many entries per feed under normal quota usage. */
  perFeedCap: number;
  /** Tighten the per-feed cap to this value once the quota guard trips. */
  quotaGuardCap: number;
  /** Quota usage ratio (0..1) above which the quota guard tightens the cap. */
  quotaThreshold: number;
}

export const DEFAULT_RETENTION_POLICY: RetentionPolicy = {
  neverPruneWindowDays: 30,
  ageCapDays: 90,
  perFeedCap: 500,
  quotaGuardCap: 200,
  quotaThreshold: 0.8,
};

export interface PrunableEntry {
  id: string;
  read: 0 | 1;
  starred: 0 | 1;
  publishedAt: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Finding 2, Slice 5 correction round: this module has NO production call
 * site yet. It was built in Slice 2 with its own unit tests, but nothing on
 * the ingestion path (`services/subscribeToFeed.ts`) invokes it, so no
 * per-feed cap or quota guard is currently enforced anywhere. This is a
 * deliberate, stated deferral, not an oversight: design.md §3 places
 * retention "after every successful refresh", which is Slice 6's
 * `services/refreshFeeds.ts`. `subscribeToFeed.ts`'s own header comment
 * carries the same statement from the ingestion side.
 *
 * Pure selector for retention/pruning (design.md §3), applied per feed:
 * 1. Never prune a starred entry, or an unread entry within the
 *    never-prune window.
 * 2. Age cap: drop a read, unstarred entry once it crosses ageCapDays.
 * 3. Per-feed cap: keep only the newest perFeedCap survivors.
 * 4. Quota guard: above quotaThreshold usage, tighten the per-feed cap.
 */
export function selectPrunableEntries(
  entries: readonly PrunableEntry[],
  policy: RetentionPolicy,
  now: Date,
  quotaUsageRatio = 0,
): string[] {
  const neverPruneWindowMs = policy.neverPruneWindowDays * DAY_MS;
  const ageCapMs = policy.ageCapDays * DAY_MS;
  const perFeedCap =
    quotaUsageRatio > policy.quotaThreshold ? policy.quotaGuardCap : policy.perFeedCap;

  const survivorIds = new Set(
    entries
      .filter((entry) => {
        if (entry.starred === 1) return true;
        const ageMs = now.getTime() - Date.parse(entry.publishedAt);
        return entry.read === 0 && ageMs <= neverPruneWindowMs;
      })
      .map((entry) => entry.id),
  );

  const ageCapPruneIds = entries
    .filter((entry) => {
      if (survivorIds.has(entry.id)) return false;
      const ageMs = now.getTime() - Date.parse(entry.publishedAt);
      return entry.read === 1 && entry.starred === 0 && ageMs > ageCapMs;
    })
    .map((entry) => entry.id);
  const ageCapPruneIdSet = new Set(ageCapPruneIds);

  const remaining = entries.filter(
    (entry) => !survivorIds.has(entry.id) && !ageCapPruneIdSet.has(entry.id),
  );
  const newestFirst = [...remaining].sort(
    (a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt),
  );
  const perFeedCapPruneIds = newestFirst.slice(perFeedCap).map((entry) => entry.id);

  return [...ageCapPruneIds, ...perFeedCapPruneIds];
}
