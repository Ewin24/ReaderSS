/**
 * Binds `EntryList` (presentational, props-in/callbacks-out) to the real
 * `toggleRead`/`toggleStar` services via the services context (design.md
 * §1). Both services are the ONLY writers of their respective change
 * timestamps (design.md §4) -- this container calls them directly, with no
 * intermediate state of its own, so there is exactly one write path from a
 * click to a stamped entry.
 *
 * Finding 3 (Slice 6 correction round): a failed write is reported through
 * `onToggleError`, never left as a silent no-op. `toggleRead`/`toggleStar`
 * already catch their own store failures and resolve to a `status: "error"`
 * result instead of rejecting, but `handleResult` below still branches on a
 * rejected promise too, so a genuinely unexpected throw elsewhere in the
 * chain is not silently swallowed either.
 *
 * NOT YET MOUNTED into `App.tsx`/`main.tsx` (Finding 5, Slice 6 correction
 * round). This is deliberate, not an oversight: there is no composition
 * root wiring a real, persisted feed list into the app yet, and no "add a
 * feed" UI anywhere in the plan to populate one -- mounting this container
 * against `App.tsx`'s current fixture data would render toggle buttons that
 * silently no-op. Slice 10 (composition root + add-feed UI) is where this
 * container gets mounted; this file and its test are proof the wiring
 * already works end-to-end against the real services, ahead of that slice.
 */
import { useCallback } from "preact/hooks";
import { useServices } from "../../app/providers/ServicesContext";
import { toggleRead } from "../../services/toggleRead";
import { toggleStar } from "../../services/toggleStar";
import type { ToggleFieldResult } from "../../services/toggleEntryField";
import { EntryList, type EntryListProps } from "../components/EntryList";

export type EntryListContainerProps = Omit<EntryListProps, "onToggleRead" | "onToggleStar"> & {
  /** Called after a toggle's write settles, so the parent can refresh its
   * copy of `entries` from the store. */
  onEntryChanged?: (entryId: string) => void;
  /** Called instead of `onEntryChanged` when a toggle's write fails, so the
   * failure is visible rather than a click that silently did nothing. */
  onToggleError?: (entryId: string, message: string) => void;
};

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function EntryListContainer({ onEntryChanged, onToggleError, ...listProps }: EntryListContainerProps) {
  const services = useServices();
  const { entries } = listProps;

  const handleResult = useCallback(
    (entryId: string, result: { status: ToggleFieldResult["status"]; message?: string }) => {
      if (result.status === "error") {
        onToggleError?.(entryId, result.message ?? "Failed to save change");
        return;
      }
      onEntryChanged?.(entryId);
    },
    [onEntryChanged, onToggleError],
  );

  const handleToggleRead = useCallback(
    (entryId: string) => {
      const current = entries.find((entry) => entry.id === entryId);
      if (current === undefined) return;
      toggleRead(services, entryId, current.read === 1 ? 0 : 1)
        .then((result) => handleResult(entryId, result))
        .catch((error: unknown) => onToggleError?.(entryId, describeError(error)));
    },
    [services, entries, handleResult, onToggleError],
  );

  const handleToggleStar = useCallback(
    (entryId: string) => {
      const current = entries.find((entry) => entry.id === entryId);
      if (current === undefined) return;
      toggleStar(services, entryId, current.starred === 1 ? 0 : 1)
        .then((result) => handleResult(entryId, result))
        .catch((error: unknown) => onToggleError?.(entryId, describeError(error)));
    },
    [services, entries, handleResult, onToggleError],
  );

  return <EntryList {...listProps} onToggleRead={handleToggleRead} onToggleStar={handleToggleStar} />;
}
