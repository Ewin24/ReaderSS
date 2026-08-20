/**
 * Binds `ReadingPane` to the real `toggleRead`/`toggleStar` services via the
 * services context. Also owns the one behaviour that is
 * specifically about OPENING an entry, not toggling it: opening an entry
 * marks it read. Mounting on -- or receiving -- an
 * unread entry marks it read through the same single `toggleRead` writer,
 * never by constructing a `readChangedAt` value itself.
 *
 * A failed write -- including the automatic mark-as-read on open -- is
 * reported through `onToggleError`, never left as a silent no-op. See
 * `EntryListContainer.tsx`'s matching comment for the full rationale.
 *
 * This container is mounted into `App.tsx` via the composition root
 * (`buildServices.ts`), same as `EntryListContainer.tsx`.
 */
import { useCallback, useEffect, useRef } from "preact/hooks";
import { useServices } from "../../app/providers/ServicesContext";
import { toggleRead } from "../../services/toggleRead";
import { toggleStar } from "../../services/toggleStar";
import type { ToggleFieldResult } from "../../services/toggleEntryField";
import { describeError } from "../../domain/errors/describeError";
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

  // Tracks the id of the entry this effect has already made its one
  // auto-mark-as-read attempt for. `entry` is a LIVE object from App's own
  // state, not a static prop -- once this effect writes `read: 1`, App
  // re-renders with the fresh entry and hands it back down here. Without
  // this guard, that re-render's changed
  // `entry.read` would re-trigger the effect and immediately overwrite a
  // user's explicit "Mark as unread" click back to `read: 1`, the instant
  // they made it. Gating on entry id (not `entry.read`) means the auto-mark
  // decision is made exactly once per opened entry, at open time -- exactly
  // what "opening an entry marks it read" requires -- and never again for
  // that same entry no matter how its `read` value changes afterward.
  const autoMarkedEntryIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (entry === null) return;
    if (autoMarkedEntryIdRef.current === entry.id) return;
    autoMarkedEntryIdRef.current = entry.id;
    if (entry.read === 1) return;
    const entryId = entry.id;
    toggleRead(services, entryId, 1)
      .then((result) => handleResult(entryId, result))
      .catch((error: unknown) => onToggleError?.(entryId, describeError(error)));
  }, [entry, services, handleResult, onToggleError]);

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
