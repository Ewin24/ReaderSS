import { deleteDB, openDB } from "idb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DB_NAME,
  DB_VERSION,
  DatabaseBlockedError,
  openReaderSSDatabase,
  type ReaderSSDatabase,
} from "./schema";

vi.mock("idb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("idb")>();
  return { ...actual, openDB: vi.fn(actual.openDB), deleteDB: vi.fn(actual.deleteDB) };
});

let openDb: ReaderSSDatabase | undefined;

afterEach(() => {
  openDb?.close();
  openDb = undefined;
});

describe("openReaderSSDatabase — v0 to v1 upgrade", () => {
  it("creates every object store and index the schema requires", async () => {
    openDb = await openReaderSSDatabase();

    expect(openDb.name).toBe(DB_NAME);
    expect(openDb.version).toBe(DB_VERSION);
    expect(Array.from(openDb.objectStoreNames).sort()).toEqual([
      "config",
      "entries",
      "feeds",
    ]);
  });

  it("creates the feeds store with the by-folder index", async () => {
    openDb = await openReaderSSDatabase();

    const tx = openDb.transaction("feeds", "readonly");
    expect(Array.from(tx.store.indexNames)).toEqual(["by-folder"]);
    await tx.done;
  });

  it("creates the entries store with every index required by design.md §3", async () => {
    openDb = await openReaderSSDatabase();

    const tx = openDb.transaction("entries", "readonly");
    expect(Array.from(tx.store.indexNames).sort()).toEqual(
      [
        "by-feed",
        "by-feed-guid",
        "by-feed-published",
        "by-published",
        "by-read-published",
        "by-starred-changed",
      ].sort(),
    );
    await tx.done;
  });

  it("encodes read/starred as 0|1 — booleans are not valid IDB keys", async () => {
    openDb = await openReaderSSDatabase();

    await openDb.put("entries", {
      id: "feed:1",
      feedId: "feed",
      guid: "g1",
      contentHash: "h1",
      title: "t",
      link: "https://example.com/1",
      author: null,
      publishedAt: "2026-08-19T00:00:00.000Z",
      fetchedAt: "2026-08-19T00:00:00.000Z",
      summaryHtml: null,
      contentHtml: null,
      hasFullContent: 0,
      read: 1,
      readChangedAt: "2026-08-19T00:00:00.000Z",
      starred: 0,
      starredChangedAt: null,
      updatedAt: "2026-08-19T00:00:00.000Z",
    });

    const found = await openDb.getFromIndex("entries", "by-read-published", [
      1,
      "2026-08-19T00:00:00.000Z",
    ]);
    expect(found?.id).toBe("feed:1");
  });
});

describe("openReaderSSDatabase — destructive-reset escape hatch", () => {
  it("recreates a database whose on-disk version is newer than this build supports", async () => {
    // A rolled-back build pointing at an on-disk database written by a
    // newer schema version: opening at DB_VERSION (1) throws a VersionError
    // because the stored version (2) is higher. This is the real trigger
    // for the destructive-reset path, not a hand-simulated corruption.
    const { openDB } = await import("idb");
    const newer = await openDB(DB_NAME, 2, {
      upgrade(db) {
        db.createObjectStore("feeds", { keyPath: "id" });
      },
    });
    newer.close();

    openDb = await openReaderSSDatabase();

    expect(openDb.version).toBe(DB_VERSION);
    expect(Array.from(openDb.objectStoreNames).sort()).toEqual([
      "config",
      "entries",
      "feeds",
    ]);
  });

  it("preserves config/github across a destructive reset when it was readable", async () => {
    const { openDB } = await import("idb");
    const newer = await openDB(DB_NAME, 2, {
      upgrade(db) {
        db.createObjectStore("feeds", { keyPath: "id" });
        db.createObjectStore("config", { keyPath: "key" });
      },
    });
    await newer.put("config", {
      key: "github",
      value: { repoOwner: "me", repoName: "notes" },
    });
    newer.close();

    openDb = await openReaderSSDatabase();

    const preserved = await openDb.get("config", "github");
    expect(preserved?.value).toEqual({ repoOwner: "me", repoName: "notes" });
  });
});

describe("openReaderSSDatabase — narrowed destructive-reset catch", () => {
  beforeEach(() => {
    vi.mocked(deleteDB).mockClear();
  });

  it("does NOT trigger the destructive reset for an unrelated open failure (e.g. storage disabled)", async () => {
    const storageDisabledError = new Error("storage disabled");
    vi.mocked(openDB).mockRejectedValueOnce(storageDisabledError);

    await expect(openReaderSSDatabase()).rejects.toBe(storageDisabledError);
    expect(deleteDB).not.toHaveBeenCalled();
  });

  // The positive branch — a genuine VersionError DOES trigger the
  // destructive reset — is already covered by the "recreates a database
  // whose on-disk version is newer than this build supports" test above,
  // driven by a real VersionError from a real newer on-disk version.
});

describe("openReaderSSDatabase — blocked-open handling", () => {
  it("closes this connection and notifies the caller when it blocks a newer version opening elsewhere (e.g. another tab)", async () => {
    const onBlocking = vi.fn();
    openDb = await openReaderSSDatabase({ onBlocking });

    // Simulate another tab reloading after a schema bump: it requests a
    // higher version while our connection is still open. Without a
    // `blocking` handler our connection would never close, and the other
    // tab's open request would hang forever (the exact failure scenario).
    const otherTabOpen = openDB(DB_NAME, DB_VERSION + 1, {
      upgrade(db) {
        db.createObjectStore("scratch");
      },
    });

    const otherTabDb = await otherTabOpen;
    otherTabDb.close();

    expect(onBlocking).toHaveBeenCalledTimes(1);
  });

  it("rejects with DatabaseBlockedError instead of hanging forever once the blocked timeout elapses", async () => {
    vi.useFakeTimers();
    try {
      let blockedCallback: (() => void) | undefined;
      vi.mocked(openDB).mockImplementationOnce(
        (_name, _version, callbacks) =>
          new Promise(() => {
            // Never resolves/rejects on its own — this is exactly what real
            // IndexedDB does when an open request is blocked: it stays
            // pending indefinitely, with no built-in timeout. We capture
            // the `blocked` callback so the test can trigger it directly,
            // the same way the real IDB request would fire the `blocked`
            // event.
            blockedCallback = () => callbacks?.blocked?.(1, 2, {} as IDBVersionChangeEvent);
          }),
      );

      const openPromise = openReaderSSDatabase({ blockedTimeoutMs: 10_000 });
      const assertion = expect(openPromise).rejects.toBeInstanceOf(DatabaseBlockedError);

      await vi.waitFor(() => expect(blockedCallback).toBeDefined());
      blockedCallback?.();
      await vi.advanceTimersByTimeAsync(10_000);

      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
