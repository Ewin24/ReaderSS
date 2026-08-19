import { describe, expect, it } from "vitest";
import {
  DEFAULT_RETENTION_POLICY,
  selectPrunableEntries,
  type PrunableEntry,
} from "./prunePolicy";

const NOW = new Date("2026-08-19T00:00:00.000Z");

function entry(overrides: Partial<PrunableEntry> & { id: string }): PrunableEntry {
  return {
    read: 0,
    starred: 0,
    publishedAt: "2026-08-19T00:00:00.000Z",
    ...overrides,
  };
}

describe("selectPrunableEntries — never-prune rule", () => {
  it("never selects a starred entry even if it is old and read", () => {
    const old = entry({
      id: "old-starred",
      read: 1,
      starred: 1,
      publishedAt: "2020-01-01T00:00:00.000Z",
    });

    const result = selectPrunableEntries([old], DEFAULT_RETENTION_POLICY, NOW);

    expect(result).not.toContain("old-starred");
  });

  it("never selects an unread entry inside the 30-day window", () => {
    const recent = entry({
      id: "recent-unread",
      read: 0,
      publishedAt: "2026-08-10T00:00:00.000Z", // 9 days before NOW
    });

    const result = selectPrunableEntries([recent], DEFAULT_RETENTION_POLICY, NOW);

    expect(result).not.toContain("recent-unread");
  });
});

describe("selectPrunableEntries — 90-day age cap", () => {
  it("selects a read, unstarred entry older than 90 days", () => {
    const stale = entry({
      id: "stale-read",
      read: 1,
      starred: 0,
      publishedAt: "2026-01-01T00:00:00.000Z", // well over 90 days before NOW
    });

    const result = selectPrunableEntries([stale], DEFAULT_RETENTION_POLICY, NOW);

    expect(result).toEqual(["stale-read"]);
  });

  it("does not select a read, unstarred entry within 90 days", () => {
    const fresh = entry({
      id: "fresh-read",
      read: 1,
      starred: 0,
      publishedAt: "2026-08-01T00:00:00.000Z", // 18 days before NOW
    });

    const result = selectPrunableEntries([fresh], DEFAULT_RETENTION_POLICY, NOW);

    expect(result).not.toContain("fresh-read");
  });
});

describe("selectPrunableEntries — 500-per-feed cap", () => {
  it("keeps only the newest 500 survivors and prunes the rest", () => {
    const entries: PrunableEntry[] = Array.from({ length: 520 }, (_, index) =>
      entry({
        id: `entry-${index}`,
        read: 1,
        starred: 0,
        // Newer index = newer publish date, all within the 90-day age cap
        // so only the per-feed cap applies.
        publishedAt: new Date(NOW.getTime() - index * 60_000).toISOString(),
      }),
    );

    const result = selectPrunableEntries(entries, DEFAULT_RETENTION_POLICY, NOW);

    expect(result).toHaveLength(20);
    // The 20 oldest (highest index) entries must be the ones pruned.
    expect(result).toContain("entry-519");
    expect(result).not.toContain("entry-0");
  });
});

describe("selectPrunableEntries — quota guard tightening to 200", () => {
  it("tightens the per-feed cap to 200 when quota usage exceeds 80%", () => {
    const entries: PrunableEntry[] = Array.from({ length: 250 }, (_, index) =>
      entry({
        id: `entry-${index}`,
        read: 1,
        starred: 0,
        publishedAt: new Date(NOW.getTime() - index * 60_000).toISOString(),
      }),
    );

    const underQuota = selectPrunableEntries(entries, DEFAULT_RETENTION_POLICY, NOW, 0.5);
    const overQuota = selectPrunableEntries(entries, DEFAULT_RETENTION_POLICY, NOW, 0.9);

    expect(underQuota).toHaveLength(0);
    expect(overQuota).toHaveLength(50);
  });
});
