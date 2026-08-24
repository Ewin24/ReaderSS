/**
 * Subscribes to every feed listed in an OPML document, reusing
 * `subscribeToFeed` unchanged -- so an imported feed goes through exactly the
 * same fetch, parse, validation, duplicate check and atomic write as one
 * typed into the add-feed box. Nothing about import is a shortcut past that.
 *
 * SEQUENTIAL ON PURPOSE. A 60-feed OPML file fired off in parallel is 60
 * simultaneous relay requests from one client, which is both rude to the
 * origins and the shape of traffic the deployment's rate limiting exists to
 * stop (see DEPLOYMENT.md). One at a time is slower and is the correct
 * default; `onProgress` exists so the wait is visible rather than silent.
 *
 * NEVER THROWS. Every per-feed failure is recorded as that feed's outcome and
 * the import continues: one unreachable feed in a 60-feed file must not cost
 * the other 59.
 */
import { flattenOpmlOutlines, type OpmlSubscription } from "../domain/opml/opmlSubscriptions";
import { describeError } from "../domain/errors/describeError";
import type { OpmlCodecPort } from "../ports/OpmlCodecPort";
import {
  subscribeToFeed,
  type SubscribeToFeedDeps,
  type SubscribeToFeedResult,
} from "./subscribeToFeed";

export interface ImportOpmlDeps extends SubscribeToFeedDeps {
  readonly opmlCodec: OpmlCodecPort;
}

/** What happened to one feed listed in the file. */
export interface ImportedFeedOutcome {
  readonly url: string;
  readonly title: string | null;
  readonly folder: string | null;
  readonly status: SubscribeToFeedResult["status"] | "cancelled";
  /** Present only when the status carries an explanation worth showing. */
  readonly message: string | null;
}

export interface ImportOpmlSummary {
  readonly added: number;
  readonly duplicates: number;
  readonly failed: number;
  readonly cancelled: number;
}

export type ImportOpmlResult =
  /** The file is not OPML at all. */
  | { readonly status: "invalid-file"; readonly message: string }
  /** Valid OPML, but it lists no usable feed. */
  | { readonly status: "no-feeds" }
  | {
      readonly status: "completed";
      readonly outcomes: readonly ImportedFeedOutcome[];
      readonly summary: ImportOpmlSummary;
    };

export interface ImportOpmlOptions {
  /** Called after each feed settles, so a long import is not a frozen screen. */
  readonly onProgress?: (done: number, total: number) => void;
  /**
   * Stops the import between feeds. Feeds already subscribed STAY subscribed
   * -- an import is not a transaction, and pretending otherwise would mean
   * deleting feeds the user can see were added.
   */
  readonly signal?: AbortSignal;
}

function messageOf(result: SubscribeToFeedResult): string | null {
  return "message" in result ? result.message : null;
}

async function subscribeOne(
  deps: ImportOpmlDeps,
  subscription: OpmlSubscription,
): Promise<ImportedFeedOutcome> {
  const base = {
    url: subscription.url,
    title: subscription.title,
    folder: subscription.folder,
  };

  try {
    const result = await subscribeToFeed(deps, {
      url: subscription.url,
      folder: subscription.folder,
      note: subscription.note,
    });
    return { ...base, status: result.status, message: messageOf(result) };
  } catch (error: unknown) {
    // `subscribeToFeed` reports its known failures as typed results; a
    // rejection here is an unexpected one (an adapter bug, a store that threw
    // where it documents it does not). It still must not abort the import.
    return { ...base, status: "persist-failed", message: describeError(error) };
  }
}

export async function importOpml(
  deps: ImportOpmlDeps,
  xml: string,
  options: ImportOpmlOptions = {},
): Promise<ImportOpmlResult> {
  const parsed = deps.opmlCodec.parse(xml);
  if (parsed.status === "invalid") {
    return { status: "invalid-file", message: parsed.message };
  }

  const subscriptions = flattenOpmlOutlines(parsed.outlines);
  if (subscriptions.length === 0) {
    return { status: "no-feeds" };
  }

  const outcomes: ImportedFeedOutcome[] = [];
  let cancelled = false;

  for (const subscription of subscriptions) {
    if (cancelled || options.signal?.aborted === true) {
      cancelled = true;
      outcomes.push({
        url: subscription.url,
        title: subscription.title,
        folder: subscription.folder,
        status: "cancelled",
        message: null,
      });
      continue;
    }

    outcomes.push(await subscribeOne(deps, subscription));
    options.onProgress?.(outcomes.length, subscriptions.length);
  }

  return {
    status: "completed",
    outcomes,
    summary: {
      added: outcomes.filter((outcome) => outcome.status === "subscribed").length,
      duplicates: outcomes.filter((outcome) => outcome.status === "duplicate").length,
      cancelled: outcomes.filter((outcome) => outcome.status === "cancelled").length,
      failed: outcomes.filter(
        (outcome) =>
          outcome.status !== "subscribed" &&
          outcome.status !== "duplicate" &&
          outcome.status !== "cancelled",
      ).length,
    },
  };
}
