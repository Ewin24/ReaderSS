/**
 * Binds `AddFeedForm` (presentational) to the real `subscribeToFeed` service
 * via the services context. `Services`
 * (localStore, clock, feedSource, feedParser) is structurally a
 * `SubscribeToFeedDeps`, so `services` is passed straight through -- the
 * same pattern `EntryListContainer`/`ReadingPaneContainer` already use for
 * `toggleRead`/`toggleStar`.
 *
 * Maps each of `SubscribeToFeedResult`'s six outcomes onto `AddFeedForm`'s
 * `status` prop with a specific, composed message:
 * `not-a-feed` and `unreachable` both name the submitted URL, since the
 * result itself does not carry it -- the message must state
 * "no feed was found at <url>" / the unreachable reason, not just repeat the
 * port's raw error text.
 */
import { useCallback, useState } from "preact/hooks";
import { useServices } from "../../app/providers/ServicesContext";
import { subscribeToFeed, type SubscribeToFeedResult } from "../../services/subscribeToFeed";
import { describeError } from "../../domain/errors/describeError";
import { AddFeedForm, type AddFeedFormStatus } from "../components/AddFeedForm";

export interface AddFeedContainerProps {
  /** Called only when the subscription actually succeeds, with the new
   * feed's id -- never for any of the other five outcomes. */
  onSubscribed?: (feedId: string) => void;
}

function toFormStatus(url: string, result: SubscribeToFeedResult): AddFeedFormStatus {
  switch (result.status) {
    case "subscribed":
      return { kind: "subscribed", feedTitle: result.feed.title };
    case "duplicate":
      return { kind: "duplicate", feedTitle: result.existing.title };
    case "invalid-url":
      return { kind: "invalid-url" };
    case "not-a-feed":
      return { kind: "not-a-feed", message: `No feed was found at ${url}. ${result.message}` };
    case "unreachable":
      return { kind: "unreachable", message: `Could not reach ${url}. ${result.message}` };
    case "persist-failed":
      return { kind: "persist-failed", message: result.message };
    case "relay-unavailable":
      return { kind: "relay-unavailable", message: result.message };
    case "too-large":
      return { kind: "too-large", message: result.message };
  }
}

export function AddFeedContainer({ onSubscribed }: AddFeedContainerProps) {
  const services = useServices();
  const [status, setStatus] = useState<AddFeedFormStatus>({ kind: "idle" });

  const handleSubmit = useCallback(
    (url: string) => {
      setStatus({ kind: "submitting" });
      subscribeToFeed(services, { url })
        .then((result) => {
          setStatus(toFormStatus(url, result));
          if (result.status === "subscribed") {
            onSubscribed?.(result.feed.id);
          }
        })
        .catch((error: unknown) => {
          setStatus({ kind: "persist-failed", message: describeError(error) });
        });
    },
    [services, onSubscribed],
  );

  return <AddFeedForm status={status} onSubmit={handleSubmit} />;
}
