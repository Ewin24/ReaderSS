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
 * Finding 2, Slice 5 correction round -- resolved in Slice 6: this module's
 * one production call site is now `services/refreshFeeds.ts`, run after
 * every successful per-feed refresh (design.md §3's placement). The initial
 * `subscribeToFeed.ts` ingestion path still does not call it (see that
 * file's header comment) -- a large feed's very first fetch is unbounded
 * until its next refresh.
 *
 * Tiers 1-3 below are exercised by `refreshFeeds.ts` with the default
 * `quotaUsageRatio` (0), so tier 4's tightened cap is implemented and
 * unit-tested here, but has no production caller yet: `refreshFeeds.ts`
 * does not read `navigator.storage.estimate()` and pass a live ratio in.
 * Wiring real quota-guard telemetry is a stated follow-up, not a claim this
 * module makes about itself.
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
