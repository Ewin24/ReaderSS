/**
 * Binds `ReadingPane` to the real `toggleRead`/`toggleStar` services via the
 * services context (design.md §1). Also owns the one behaviour that is
 * specifically about OPENING an entry, not toggling it (entry-reading spec,
 * "Opening an entry marks it read"): mounting on -- or receiving -- an
 * unread entry marks it read through the same single `toggleRead` writer,
 * never by constructing a `readChangedAt` value itself.
 *
 * Finding 3 (Slice 6 correction round): a failed write -- including the
 * automatic mark-as-read on open -- is reported through `onToggleError`,
 * never left as a silent no-op. See `EntryListContainer.tsx`'s matching
 * comment for the full rationale.
 *
 * NOT YET MOUNTED into `App.tsx`/`main.tsx` (Finding 5, Slice 6 correction
 * round) -- same reason and same resolution as `EntryListContainer.tsx`:
 * no composition root and no "add a feed" UI exist yet to give it real
 * data. Slice 10 (composition root + add-feed UI) is where this container
 * gets mounted.
 */
import { useCallback, useEffect } from "preact/hooks";
import { useServices } from "../../app/providers/ServicesContext";
import { toggleRead } from "../../services/toggleRead";
import { toggleStar } from "../../services/toggleStar";
import type { ToggleFieldResult } from "../../services/toggleEntryField";
import { ReadingPane, type ReadingPaneProps } from "../components/ReadingPane";

export type ReadingPaneContainerProps = Omit<ReadingPaneProps, "onToggleRead" | "onToggleStar"> & {
  /** Called after a toggle's write settles, so the parent can refresh its
   * copy of the entry from the store. */
  onEntryChanged?: (entryId: string) => void;
  /** Called instead of `onEntryChanged` when a toggle's write fails, so the
   * failure is visible rather than a click (or an automatic mark-as-read)
   * that silently did nothing. */
  onToggleError?: (entryId: string, message: string) => void;
};

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function ReadingPaneContainer({
  entry,
  onEntryChanged,
  onToggleError,
  ...paneProps
}: ReadingPaneContainerProps) {
  const services = useServices();

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

  useEffect(() => {
    if (entry === null || entry.read === 1) return;
    const entryId = entry.id;
    toggleRead(services, entryId, 1)
      .then((result) => handleResult(entryId, result))
      .catch((error: unknown) => onToggleError?.(entryId, describeError(error)));
    // Only `entry.id`/`entry.read` need to be watched -- re-running this
    // effect for every unrelated field change on the same open entry would
    // needlessly re-check an already-settled read state.
  }, [entry?.id, entry?.read, services, handleResult, onToggleError]);

  const handleToggleRead = useCallback(
    (entryId: string) => {
      if (entry === null) return;
      toggleRead(services, entryId, entry.read === 1 ? 0 : 1)
        .then((result) => handleResult(entryId, result))
        .catch((error: unknown) => onToggleError?.(entryId, describeError(error)));
    },
    [entry, services, handleResult, onToggleError],
  );

  const handleToggleStar = useCallback(
    (entryId: string) => {
      if (entry === null) return;
      toggleStar(services, entryId, entry.starred === 1 ? 0 : 1)
        .then((result) => handleResult(entryId, result))
        .catch((error: unknown) => onToggleError?.(entryId, describeError(error)));
    },
    [entry, services, handleResult, onToggleError],
  );

  return (
    <ReadingPane
      {...paneProps}
      entry={entry}
      onToggleRead={handleToggleRead}
      onToggleStar={handleToggleStar}
    />
  );
}
