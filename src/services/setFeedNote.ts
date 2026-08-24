/**
 * Writes the reader's own note onto a feed. A thin, separately named wrapper
 * over `setFeedField` — the same shape `toggleRead`/`toggleStar` have over
 * `toggleEntryField`, so call sites stay unambiguous about which field they
 * mean. The read-modify-write rationale lives in `setFeedField.ts`.
 */
import { setFeedField, type SetFeedFieldDeps, type SetFeedFieldResult } from "./setFeedField";

export type SetFeedNoteDeps = SetFeedFieldDeps;

export type SetFeedNoteResult =
  | { readonly status: "saved"; readonly note: string | null }
  | { readonly status: "not-found" }
  | { readonly status: "error"; readonly message: string };

export async function setFeedNote(
  deps: SetFeedNoteDeps,
  feedId: string,
  note: string,
): Promise<SetFeedNoteResult> {
  const result: SetFeedFieldResult = await setFeedField(deps, feedId, "note", note);
  return result.status === "saved" ? { status: "saved", note: result.value } : result;
}
