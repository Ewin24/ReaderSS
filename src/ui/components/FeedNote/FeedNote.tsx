/**
 * Your own note about a feed -- why you subscribed, what you want from it,
 * what to ignore. Presentational only: it owns the draft being typed, and
 * hands the finished text out through `onSave`.
 *
 * COLLAPSED BY DEFAULT, and the reason matters: this sits above the entry
 * list, which is where you read. A note is written once and consulted
 * occasionally, so an always-open textarea would spend the whole session
 * taking space from the thing you actually came for. What shows when there IS
 * a note is the note's text, not an edit box.
 *
 * The note is rendered as PLAIN TEXT. It is your own writing, never feed
 * content, so it never goes near the HTML sanitization path -- and rendering
 * it as text means it cannot become a second, unguarded HTML sink.
 */
import { useEffect, useState } from "preact/hooks";

export interface FeedNoteProps {
  /** The feed the note belongs to; nothing renders without one. */
  readonly feedTitle: string | null;
  readonly note: string | null;
  readonly saving: boolean;
  readonly errorMessage: string | null;
  readonly onSave: (note: string) => void;
}

export function FeedNote({ feedTitle, note, saving, errorMessage, onSave }: FeedNoteProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note ?? "");

  // Re-seed the draft when the note itself changes identity (another feed
  // selected, or a save settled). Editing is closed at the same time so a
  // draft can never silently belong to a feed other than the one on screen.
  useEffect(() => {
    setDraft(note ?? "");
    setEditing(false);
  }, [note, feedTitle]);

  if (feedTitle === null) return null;

  function handleSubmit(event: Event) {
    event.preventDefault();
    onSave(draft);
  }

  return (
    <section class="feed-note" aria-label={`Notes for ${feedTitle}`}>
      {editing ? (
        <form class="feed-note__form" onSubmit={handleSubmit}>
          <label class="feed-note__label" for="feed-note-input">
            Your note about {feedTitle}
          </label>
          <textarea
            id="feed-note-input"
            class="feed-note__input"
            rows={4}
            value={draft}
            disabled={saving}
            placeholder="Why you follow this feed, what you want from it, what to skip…"
            onInput={(event) => setDraft((event.currentTarget as HTMLTextAreaElement).value)}
          />
          <div class="feed-note__actions">
            <button type="submit" class="feed-note__save" disabled={saving}>
              {saving ? "Saving…" : "Save note"}
            </button>
            <button
              type="button"
              class="feed-note__cancel"
              disabled={saving}
              onClick={() => {
                setDraft(note ?? "");
                setEditing(false);
              }}
            >
              Cancel
            </button>
            <span class="feed-note__hint">Saved with the feed and exported in your OPML.</span>
          </div>
        </form>
      ) : (
        <div class="feed-note__view">
          {note === null ? (
            <button type="button" class="feed-note__add" onClick={() => setEditing(true)}>
              Add a note about {feedTitle}
            </button>
          ) : (
            <>
              {/* `white-space: pre-wrap` in ui.css is what preserves the line
                * breaks a multi-line note was written with. */}
              <p class="feed-note__text">{note}</p>
              <button type="button" class="feed-note__edit" onClick={() => setEditing(true)}>
                Edit note
              </button>
            </>
          )}
        </div>
      )}

      {errorMessage !== null && (
        <p class="feed-note__error" role="alert">
          {errorMessage}
        </p>
      )}
    </section>
  );
}
