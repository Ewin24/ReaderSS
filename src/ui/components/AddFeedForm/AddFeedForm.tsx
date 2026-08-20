import { useRef } from "preact/hooks";

/**
 * Presentational form for subscribing to a feed by URL. Props in, callback
 * out -- no port or service import, matching every other `ui/components/**` in the repo.
 * `AddFeedContainer` is what actually calls `subscribeToFeed` and derives
 * this `status` prop from its six-way `SubscribeToFeedResult`.
 *
 * Each of the six outcomes below renders a textually distinct, specific
 * message (never a shared generic fallback) -- this project's review history
 * repeatedly rejected collapsing `unreachable` and `not-a-feed` into one
 * "something went wrong" string, since they are different, actionable
 * problems for the user.
 */
export type AddFeedFormStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "submitting" }
  | { readonly kind: "subscribed"; readonly feedTitle: string }
  | { readonly kind: "duplicate"; readonly feedTitle: string }
  | { readonly kind: "invalid-url" }
  | { readonly kind: "not-a-feed"; readonly message: string }
  | { readonly kind: "unreachable"; readonly message: string }
  | { readonly kind: "persist-failed"; readonly message: string }
  // Found by real use: the relay itself never responded (e.g. a dev server
  // with no Worker wired in), so nothing about the submitted feed is known
  // to be wrong. Kept distinct from "unreachable", which reports a real
  // origin-server failure the relay actually observed.
  | { readonly kind: "relay-unavailable"; readonly message: string }
  // The relay reached the origin, but the body exceeded the relay's 5 MiB
  // cap. Kept distinct from "unreachable" -- that status's "Could not
  // reach" wording would be false here; the feed WAS reached.
  | { readonly kind: "too-large"; readonly message: string };

export interface AddFeedFormProps {
  status: AddFeedFormStatus;
  onSubmit: (url: string) => void;
}

function describeStatus(status: AddFeedFormStatus): { text: string; isError: boolean } | null {
  switch (status.kind) {
    case "idle":
    case "submitting":
      return null;
    case "subscribed":
      return { text: `Added "${status.feedTitle}".`, isError: false };
    case "duplicate":
      return {
        text: `You're already subscribed to "${status.feedTitle}".`,
        isError: true,
      };
    case "invalid-url":
      return { text: "Enter an absolute http:// or https:// URL.", isError: true };
    case "not-a-feed":
      return { text: status.message, isError: true };
    case "unreachable":
      return { text: status.message, isError: true };
    case "persist-failed":
      return {
        text: `The feed was found, but it could not be saved. ${status.message}`,
        isError: true,
      };
    case "relay-unavailable":
      return {
        text: `This app's feed relay isn't responding right now, so nothing was checked yet. ${status.message}`,
        isError: true,
      };
    case "too-large":
      return {
        text: `That feed is too large for this app to fetch. ${status.message}`,
        isError: true,
      };
  }
}

export function AddFeedForm({ status, onSubmit }: AddFeedFormProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const submitting = status.kind === "submitting";
  const statusMessage = describeStatus(status);

  function handleSubmit(event: Event) {
    event.preventDefault();
    const url = inputRef.current?.value.trim() ?? "";
    if (url === "") return;
    onSubmit(url);
  }

  return (
    <form class="add-feed-form" onSubmit={handleSubmit}>
      <label class="add-feed-form__label" for="add-feed-url">
        Feed URL
      </label>
      <input
        id="add-feed-url"
        ref={inputRef}
        class="add-feed-form__input"
        // Deliberately `type="text"`, not `type="url"`: HTML5's native URL
        // constraint validation would silently swallow the submit event for
        // an invalid value before `onSubmit` ever runs, bypassing
        // `subscribeToFeed`'s own client-side check -- a malformed URL must
        // be rejected before any network request -- and
        // its `invalid-url` status -- which is what actually drives this
        // form's message, and needs to run for every submission, not just
        // the ones the browser's own heuristic considers well-formed.
        type="text"
        name="url"
        placeholder="https://example.com/feed.xml"
        disabled={submitting}
        required
      />
      <button type="submit" class="add-feed-form__submit" disabled={submitting}>
        {submitting ? "Adding…" : "Add feed"}
      </button>
      {statusMessage && (
        <p
          class="add-feed-form__message"
          role={statusMessage.isError ? "alert" : "status"}
        >
          {statusMessage.text}
        </p>
      )}
    </form>
  );
}
