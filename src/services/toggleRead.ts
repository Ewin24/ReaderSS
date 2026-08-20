/**
 * The ONLY writer of `Entry.read` / `Entry.readChangedAt` in the whole
 * codebase (design.md §4's pseudocode; Amendment C, entry-reading spec
 * "Read state"). `readChangedAt` records the moment the field last
 * *changed*, not when it became true -- the merge (`resolveField`)
 * resolves conflicts by last-write-wins on this timestamp, so a value
 * forged by any other code path (refresh, merge, initial load) would make a
 * mathematically correct resolver still produce the wrong answer.
 *
 * A thin, named, field-specific wrapper around the shared
 * `toggleEntryField` algorithm -- see that module's doc comment for the
 * full write-path rationale, which
 * applies here unchanged:
 *   1. `readChangedAt` is stamped on BOTH directions, 0->1 and 1->0.
 *   2. A no-op (setting the value it already has) does NOT advance the
 *      timestamp -- otherwise idle UI churn could beat a genuine remote
 *      change in the merge.
 *   3. Refresh, merge, and initial load never call this function, so they
 *      can never forge a change timestamp. This file's tests can only prove
 *      the "loading state alone never stamps" half of that claim (nothing
 *      here depends on a refresh/merge implementation); the refresh-specific
 *      half -- that a re-fetched entry keeps its existing read/readChangedAt
 *      untouched -- is verified end-to-end in `refreshFeeds.test.ts`, the
 *      only place that claim is actually exercised against real production
 *      code.
 */
import type { ClockPort } from "../ports/ClockPort";
import type { LocalStorePort } from "../ports/LocalStorePort";
import { toggleEntryField, type ToggleFieldResult } from "./toggleEntryField";

export interface ToggleReadDeps {
  readonly localStore: LocalStorePort;
  readonly clock: ClockPort;
}

export type ToggleReadResult =
  | { readonly status: "updated"; readonly read: 0 | 1; readonly readChangedAt: string }
  | { readonly status: "no-op"; readonly read: 0 | 1 }
  | { readonly status: "not-found" }
  | { readonly status: "error"; readonly message: string };

function fromFieldResult(result: ToggleFieldResult): ToggleReadResult {
  switch (result.status) {
    case "updated":
      return { status: "updated", read: result.value, readChangedAt: result.changedAt };
    case "no-op":
      return { status: "no-op", read: result.value };
    case "not-found":
      return { status: "not-found" };
    case "error":
      return { status: "error", message: result.message };
  }
}

export async function toggleRead(
  deps: ToggleReadDeps,
  entryId: string,
  nextRead: 0 | 1,
): Promise<ToggleReadResult> {
  const result = await toggleEntryField(deps, entryId, nextRead, {
    valueField: "read",
    timestampField: "readChangedAt",
  });
  return fromFieldResult(result);
}
