/**
 * Binds `FeedNote` to the `setFeedNote` service via the services context.
 *
 * It does NOT hold the note itself. The note comes down as a prop from
 * whoever owns the feed list (`App`), and after a successful save this
 * container reports the new value up rather than keeping a private copy. Two
 * copies of the same value drift the moment anything else touches it -- an
 * OPML import, a feed removal, another tab.
 */
import { useCallback, useState } from "preact/hooks";
import { useServices } from "../../app/providers/ServicesContext";
import { describeError } from "../../domain/errors/describeError";
import { setFeedNote } from "../../services/setFeedNote";
import { FeedNote } from "../components/FeedNote";

export interface FeedNoteContainerProps {
  readonly feedId: string | null;
  readonly feedTitle: string | null;
  readonly note: string | null;
  /** Called with the saved value so the owner of the feed list can update it. */
  readonly onNoteSaved?: (feedId: string, note: string | null) => void;
}

export function FeedNoteContainer({
  feedId,
  feedTitle,
  note,
  onNoteSaved,
}: FeedNoteContainerProps) {
  const services = useServices();
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSave = useCallback(
    (draft: string) => {
      if (feedId === null) return;
      setSaving(true);
      setErrorMessage(null);

      setFeedNote(services, feedId, draft)
        .then((result) => {
          if (result.status === "saved") {
            onNoteSaved?.(feedId, result.note);
            return;
          }
          setErrorMessage(
            result.status === "not-found"
              ? "That feed no longer exists, so the note was not saved."
              : `The note could not be saved (${result.message}).`,
          );
        })
        .catch((error: unknown) => setErrorMessage(describeError(error)))
        .finally(() => setSaving(false));
    },
    [feedId, services, onNoteSaved],
  );

  if (feedId === null) return null;

  return (
    <FeedNote
      feedTitle={feedTitle}
      note={note}
      saving={saving}
      errorMessage={errorMessage}
      onSave={handleSave}
    />
  );
}
