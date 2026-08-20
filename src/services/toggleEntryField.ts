/**
 * The shared write-path algorithm behind `toggleRead.ts` and `toggleStar.ts`
 * (Finding 6, Slice 6 correction round). Both services implemented the
 * identical control flow -- fetch entry, report not-found, detect a no-op,
 * else stamp and write -- differing only in which value/timestamp field pair
 * they touch, with two duplicated test suites substituting field names. This
 * factors the shared body into one helper parameterized by that field pair,
 * the same pattern design.md §4 already established for `resolveField`
 * (one merge resolver, applied to both `read` and `starred`). `toggleRead`
 * and `toggleStar` stay as thin, separately named, separately typed wrappers
 * so call sites remain unambiguous about which field they mean.
 *
 * Also owns Finding 3's fix: a `getEntry`/`putEntry` failure is caught here
 * and returned as a distinct `"error"` result instead of an unhandled
 * promise rejection. Callers (`EntryListContainer`, `ReadingPaneContainer`)
 * previously chained bare `.then(...)` with no `.catch`, so a rejected store
 * call vanished silently -- the button never changed state and nothing told
 * the user their click did nothing.
 */
import type { ClockPort } from "../ports/ClockPort";
import type { Entry } from "../domain/models/Entry";
import type { LocalStorePort } from "../ports/LocalStorePort";
import { describeError } from "../domain/errors/describeError";

export interface ToggleFieldDeps {
  readonly localStore: LocalStorePort;
  readonly clock: ClockPort;
}

/** Which value/timestamp field pair on `Entry` this call toggles. */
export interface FieldBinding {
  readonly valueField: "read" | "starred";
  readonly timestampField: "readChangedAt" | "starredChangedAt";
}

export type ToggleFieldResult =
  | { readonly status: "updated"; readonly value: 0 | 1; readonly changedAt: string }
  | { readonly status: "no-op"; readonly value: 0 | 1 }
  | { readonly status: "not-found" }
  | { readonly status: "error"; readonly message: string };

export async function toggleEntryField(
  deps: ToggleFieldDeps,
  entryId: string,
  nextValue: 0 | 1,
  binding: FieldBinding,
): Promise<ToggleFieldResult> {
  let entry: Entry | undefined;
  try {
    entry = await deps.localStore.getEntry(entryId);
  } catch (error) {
    return { status: "error", message: describeError(error) };
  }
  if (entry === undefined) {
    return { status: "not-found" };
  }

  const currentValue = entry[binding.valueField];
  if (currentValue === nextValue) {
    // No-op: timestamp untouched -- otherwise idle UI churn could beat a
    // genuine remote change in Slice 9's merge.
    return { status: "no-op", value: currentValue };
  }

  const changedAt = deps.clock.now();
  try {
    await deps.localStore.putEntry({
      ...entry,
      [binding.valueField]: nextValue,
      [binding.timestampField]: changedAt,
    });
  } catch (error) {
    return { status: "error", message: describeError(error) };
  }
  return { status: "updated", value: nextValue, changedAt };
}
