import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Entry } from "../../domain/models/Entry";
import type { Feed } from "../../domain/models/Feed";

export const DB_NAME = "readerss";
export const DB_VERSION = 1;
/** Any on-disk version older than this cannot be incrementally upgraded. */
export const MIN_SUPPORTED_VERSION = 1;

export interface ConfigRecord<T = unknown> {
  key: string;
  value: T;
}

export interface ReaderSSSchema extends DBSchema {
  feeds: {
    key: string;
    value: Feed;
    indexes: { "by-folder": string };
  };
  entries: {
    key: string;
    value: Entry;
    indexes: {
      "by-feed": string;
      "by-feed-published": [string, string];
      "by-published": string;
      "by-read-published": [number, string];
      "by-starred-changed": [number, string];
      "by-feed-guid": [string, string];
    };
  };
  config: {
    key: string;
    value: ConfigRecord;
  };
}

export type ReaderSSDatabase = IDBPDatabase<ReaderSSSchema>;

/** Thrown by the upgrade callback when the on-disk version cannot be incrementally migrated. */
export class UnsupportedSchemaVersionError extends Error {
  constructor(public readonly oldVersion: number) {
    super(`readerss database version ${oldVersion} is below the minimum supported version`);
    this.name = "UnsupportedSchemaVersionError";
  }
}

/**
 * Thrown when an open request stays blocked by another connection (e.g. an
 * older tab holding an outdated schema version) past `blockedTimeoutMs`.
 * Per IndexedDB semantics a blocked open never rejects on its own — this
 * error is the only way that condition becomes observable and recoverable.
 */
export class DatabaseBlockedError extends Error {
  constructor() {
    super(
      "Opening the readerss database is blocked by another connection (e.g. another open tab) and did not clear in time. Close other tabs running this app and reload.",
    );
    this.name = "DatabaseBlockedError";
  }
}

const DEFAULT_BLOCKED_TIMEOUT_MS = 10_000;

export interface OpenReaderSSDatabaseOptions {
  /** Called when this connection closes itself because it was blocking a newer version elsewhere (e.g. another tab after a deploy). Use it to prompt the user to reload this tab. */
  onBlocking?: () => void;
  /** Called if the browser abnormally terminates this connection. */
  onTerminated?: () => void;
  /** Called with the original failure right before returning a freshly recreated, healthy database (see `recreateDatabaseDestructively`). */
  onDestructiveReset?: (cause: unknown) => void;
  /** Milliseconds to wait for a blocked open/delete before rejecting with {@link DatabaseBlockedError}. */
  blockedTimeoutMs?: number;
}

/** True only for the two conditions the destructive-reset escape hatch is scoped to. */
function isRecoverableSchemaFailure(cause: unknown): boolean {
  if (cause instanceof UnsupportedSchemaVersionError) return true;
  return cause instanceof DOMException && cause.name === "VersionError";
}

/** A promise that rejects with {@link DatabaseBlockedError} once `arm()` is called, after `ms`. */
function armBlockedTimeout(ms: number): {
  promise: Promise<never>;
  arm: () => void;
  disarm: () => void;
} {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let reject!: (reason: DatabaseBlockedError) => void;
  const promise = new Promise<never>((_resolve, r) => {
    reject = r;
  });
  return {
    promise,
    arm: () => {
      if (timer) return;
      timer = setTimeout(() => reject(new DatabaseBlockedError()), ms);
    },
    disarm: () => {
      if (timer) clearTimeout(timer);
    },
  };
}

/**
 * Opens (and, on first run, creates) the readerss IndexedDB database.
 * Implements a cumulative fall-through upgrade switch plus its
 * destructive-reset escape hatch: any unsupported on-disk version
 * or an upgrade-transaction throw triggers a full delete + recreate, with
 * the `config/github` record preserved across the reset when readable.
 */
function createV1Stores(db: IDBPDatabase<ReaderSSSchema>): void {
  const feeds = db.createObjectStore("feeds", { keyPath: "id" });
  feeds.createIndex("by-folder", "folder");

  const entries = db.createObjectStore("entries", { keyPath: "id" });
  entries.createIndex("by-feed", "feedId");
  entries.createIndex("by-feed-published", ["feedId", "publishedAt"]);
  entries.createIndex("by-published", "publishedAt");
  entries.createIndex("by-read-published", ["read", "publishedAt"]);
  entries.createIndex("by-starred-changed", ["starred", "starredChangedAt"]);
  entries.createIndex("by-feed-guid", ["feedId", "guid"]);

  db.createObjectStore("config", { keyPath: "key" });
}

export async function openReaderSSDatabase(
  options: OpenReaderSSDatabaseOptions = {},
): Promise<ReaderSSDatabase> {
  const blockedTimeoutMs = options.blockedTimeoutMs ?? DEFAULT_BLOCKED_TIMEOUT_MS;
  const blockedGuard = armBlockedTimeout(blockedTimeoutMs);
  let dbHandle: ReaderSSDatabase | undefined;

  const openPromise = openDB<ReaderSSSchema>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion > 0 && oldVersion < MIN_SUPPORTED_VERSION) {
        throw new UnsupportedSchemaVersionError(oldVersion);
      }
      // Cumulative fall-through switch: each case creates only what's new
      // for that version and falls through to the next. Only v1 exists
      // today; future migrations append `case 1:` etc. below.
      switch (oldVersion) {
        case 0:
          createV1Stores(db);
          break;
        default:
          break;
      }
    },
    blocked() {
      // Another connection at an older schema version has not released it,
      // so this open request will not settle until that connection closes
      // (see `blocking` below) or the timeout fires. Per IndexedDB
      // semantics a blocked request never rejects on its own — without this
      // timeout, two open tabs at different schema versions would hang the
      // newer tab's app forever with no error and no recovery except
      // manually closing the other tab.
      blockedGuard.arm();
    },
    blocking() {
      // This connection is itself blocking a newer version elsewhere (e.g.
      // another tab reloaded after a deploy bumped DB_VERSION). Close it so
      // the other tab's open request can proceed instead of hanging;
      // notify the caller so it can prompt the user to reload this tab.
      dbHandle?.close();
      options.onBlocking?.();
    },
    terminated() {
      options.onTerminated?.();
    },
  });

  try {
    const db = await Promise.race([openPromise, blockedGuard.promise]);
    dbHandle = db;
    return db;
  } catch (cause) {
    if (isRecoverableSchemaFailure(cause)) {
      return recreateDatabaseDestructively(cause, options.onDestructiveReset, blockedTimeoutMs);
    }
    // Anything else — storage disabled, quota denied, a blocked-open
    // timeout, etc. — is NOT a schema problem, so it must NOT trigger the
    // destructive reset. Rethrowing the original error (not a wrapped copy)
    // lets a caller distinguish "storage unavailable" from "schema
    // recovered".
    throw cause;
  } finally {
    blockedGuard.disarm();
  }
}

/**
 * Config keys that must survive a destructive database wipe. `github` was
 * the original preserve target; `visual` (the visual-settings record) joined
 * it so a user's chosen theme/font/layout survives a schema-recreate reset
 * (spec "Destructive reset preservation"). This list is the single source of
 * truth for the preserve step below.
 */
export const PRESERVED_CONFIG_KEYS = ["github", "visual"] as const;

/**
 * Reads every {@link PRESERVED_CONFIG_KEYS} record through a short-lived
 * connection at whatever version is currently on disk, returning a map of
 * key → value for the records that were readable (missing/throws are simply
 * omitted). Used only by the destructive-reset escape hatch so a wipe does
 * not silently drop user preferences that were still recoverable.
 */
async function tryReadPreservedConfigs(): Promise<Map<string, unknown>> {
  const preserved = new Map<string, unknown>();
  try {
    const db = await openDB(DB_NAME);
    if (!db.objectStoreNames.contains("config")) {
      db.close();
      return preserved;
    }
    for (const key of PRESERVED_CONFIG_KEYS) {
      const record = await db.get("config", key);
      if (record?.value !== undefined) {
        preserved.set(key, record.value);
      }
    }
    db.close();
  } catch {
    // A wipe cannot proceed if reading fails — fall back to preserving nothing.
  }
  return preserved;
}

/**
 * The destructive-reset escape hatch: read every {@link PRESERVED_CONFIG_KEYS}
 * record through a short-lived connection at whatever version is currently on
 * disk, delete the database, recreate it at DB_VERSION, and write the
 * preserved records back. IndexedDB is a rebuildable cache, so losing
 * everything else is acceptable; silently corrupting the store is not.
 *
 * `cause` (the original schema failure) is intentionally NOT rethrown here
 * — recovering into a healthy database is the whole point of this escape
 * hatch. It IS observable: pass `onDestructiveReset` to be notified with
 * the original cause (e.g. to log it or tell the user their local cache
 * was rebuilt) whenever a wipe actually happens.
 */
async function recreateDatabaseDestructively(
  cause: unknown,
  onDestructiveReset?: (cause: unknown) => void,
  blockedTimeoutMs = DEFAULT_BLOCKED_TIMEOUT_MS,
): Promise<ReaderSSDatabase> {
  const preservedConfigs = await tryReadPreservedConfigs();

  const deleteGuard = armBlockedTimeout(blockedTimeoutMs);
  await Promise.race([
    deleteDB(DB_NAME, { blocked: deleteGuard.arm }),
    deleteGuard.promise,
  ]);
  deleteGuard.disarm();

  const db = await openDB<ReaderSSSchema>(DB_NAME, DB_VERSION, {
    upgrade(freshDb) {
      createV1Stores(freshDb);
    },
  });

  for (const [key, value] of preservedConfigs) {
    await db.put("config", { key, value });
  }

  onDestructiveReset?.(cause);
  return db;
}
