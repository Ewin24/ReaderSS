/**
 * The shared write path behind `setFeedNote.ts` and `setFeedFolder.ts` — the
 * same factoring `toggleEntryField.ts` already applies to
 * `toggleRead`/`toggleStar`. Both services need the identical control flow
 * (read the feed, report not-found, normalize the text, write back one
 * changed field, turn any store failure into a typed result) and differ only
 * in WHICH field they touch.
 *
 * READ-MODIFY-WRITE, deliberately: it re-reads the feed and writes back a copy
 * with only the named field changed, rather than accepting a whole `Feed` from
 * the UI. A feed row also carries fetch bookkeeping (`etag`, `lastModified`,
 * `lastFetchedAt`, `lastSuccessAt`, `lastError`) that `refreshFeeds` owns and
 * updates in the background. Letting a screen hand back a `Feed` object it had
 * been holding would let an edit saved after a refresh silently restore that
 * refresh's stale validators, and the next fetch would then re-download a feed
 * it already had — or resurrect a cleared error.
 *
 * The window between the read and the write is not locked. That is acceptable
 * for these fields and nowhere else: the only things written are values no
 * other code path ever touches, so the worst case is last-write-wins between
 * two tabs on a value a human just typed.
 */
import { describeError } from "../domain/errors/describeError";
import type { Feed } from "../domain/models/Feed";
import type { LocalStorePort } from "../ports/LocalStorePort";

export interface SetFeedFieldDeps {
  readonly localStore: LocalStorePort;
}

/** The user-editable, string-valued fields of a `Feed`. */
export type EditableFeedField = "note" | "folder";

export type SetFeedFieldResult =
  | { readonly status: "saved"; readonly value: string | null }
  | { readonly status: "not-found" }
  | { readonly status: "error"; readonly message: string };

/**
 * Blank in, `null` out. Storing `""` would make "has a note" / "is in a
 * collection" true for something with nothing in it, and would export a
 * pointless empty attribute.
 */
export function normalizeFeedFieldValue(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export async function setFeedField(
  deps: SetFeedFieldDeps,
  feedId: string,
  field: EditableFeedField,
  value: string | null,
): Promise<SetFeedFieldResult> {
  try {
    const feed = await deps.localStore.getFeed(feedId);
    if (feed === undefined) {
      // The feed was removed (in this tab or another) while the editor was open.
      return { status: "not-found" };
    }

    const normalized = normalizeFeedFieldValue(value);
    const updated: Feed = { ...feed, [field]: normalized };
    await deps.localStore.putFeed(updated);
    return { status: "saved", value: normalized };
  } catch (error: unknown) {
    return { status: "error", message: describeError(error) };
  }
}
