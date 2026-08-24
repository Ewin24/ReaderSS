/**
 * Files a feed into a collection, or takes it out of one.
 *
 * "Collection" is the interface's word for what OPML calls a feed's `folder`
 * and what this codebase stores in `Feed.folder`. One field, one meaning: a
 * feed belongs to at most one collection, which is exactly what an OPML
 * subscription list can express.
 *
 * Passing `null` (or blank) removes the feed from its collection. That is a
 * real state, not an error: an ungrouped feed is what a flat OPML file
 * produces, and the sidebar shows those together at the bottom.
 *
 * The read-modify-write rationale lives in `setFeedField.ts`.
 */
import { setFeedField, type SetFeedFieldDeps, type SetFeedFieldResult } from "./setFeedField";

export type SetFeedFolderDeps = SetFeedFieldDeps;

export type SetFeedFolderResult =
  | { readonly status: "saved"; readonly folder: string | null }
  | { readonly status: "not-found" }
  | { readonly status: "error"; readonly message: string };

export async function setFeedFolder(
  deps: SetFeedFolderDeps,
  feedId: string,
  folder: string | null,
): Promise<SetFeedFolderResult> {
  const result: SetFeedFieldResult = await setFeedField(deps, feedId, "folder", folder);
  return result.status === "saved" ? { status: "saved", folder: result.value } : result;
}
