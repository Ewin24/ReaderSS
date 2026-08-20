/**
 * The exact structural mirror of `toggleRead.ts`, for `Entry.starred` /
 * `Entry.starredChangedAt` ("Starred state"). The ONLY writer of these two
 * fields. A thin, named, field-specific
 * wrapper around the shared `toggleEntryField` algorithm. See
 * `toggleRead.ts`'s module doc comment for the full
 * rationale -- it applies here unchanged, field for field.
 */
import type { ClockPort } from "../ports/ClockPort";
import type { LocalStorePort } from "../ports/LocalStorePort";
import { toggleEntryField, type ToggleFieldResult } from "./toggleEntryField";

export interface ToggleStarDeps {
  readonly localStore: LocalStorePort;
  readonly clock: ClockPort;
}

export type ToggleStarResult =
  | { readonly status: "updated"; readonly starred: 0 | 1; readonly starredChangedAt: string }
  | { readonly status: "no-op"; readonly starred: 0 | 1 }
  | { readonly status: "not-found" }
  | { readonly status: "error"; readonly message: string };

function fromFieldResult(result: ToggleFieldResult): ToggleStarResult {
  switch (result.status) {
    case "updated":
      return { status: "updated", starred: result.value, starredChangedAt: result.changedAt };
    case "no-op":
      return { status: "no-op", starred: result.value };
    case "not-found":
      return { status: "not-found" };
    case "error":
      return { status: "error", message: result.message };
  }
}

export async function toggleStar(
  deps: ToggleStarDeps,
  entryId: string,
  nextStarred: 0 | 1,
): Promise<ToggleStarResult> {
  const result = await toggleEntryField(deps, entryId, nextStarred, {
    valueField: "starred",
    timestampField: "starredChangedAt",
  });
  return fromFieldResult(result);
}
