/**
 * Serializes the current subscription list into an OPML document.
 *
 * Subscriptions ONLY -- not entries, read state, or stars. OPML is a
 * subscription-list format; an OPML export is therefore a way to move your
 * feeds to another reader, NOT a backup of your reading history. Stated here
 * because the difference matters and is easy to assume wrong.
 */
import { describeError } from "../domain/errors/describeError";
import type { ClockPort } from "../ports/ClockPort";
import type { LocalStorePort } from "../ports/LocalStorePort";
import type { OpmlCodecPort } from "../ports/OpmlCodecPort";

export interface ExportOpmlDeps {
  readonly localStore: LocalStorePort;
  readonly opmlCodec: OpmlCodecPort;
  /** Stamps the document's `dateCreated`/`dateModified`. */
  readonly clock: ClockPort;
}

export type ExportOpmlResult =
  | { readonly status: "exported"; readonly xml: string; readonly feedCount: number }
  | { readonly status: "failed"; readonly message: string };

export const OPML_DOCUMENT_TITLE = "ReaderSS subscriptions";

export async function exportOpml(deps: ExportOpmlDeps): Promise<ExportOpmlResult> {
  try {
    const feeds = await deps.localStore.listFeeds();
    const xml = deps.opmlCodec.serialize({
      title: OPML_DOCUMENT_TITLE,
      createdAt: deps.clock.now(),
      feeds: feeds.map((feed) => ({
        url: feed.url,
        title: feed.title,
        folder: feed.folder,
        note: feed.note,
        siteUrl: feed.siteUrl,
      })),
    });

    return { status: "exported", xml, feedCount: feeds.length };
  } catch (error: unknown) {
    // A read from IndexedDB can reject (a closed/blocked database). Reported
    // as a typed failure so the UI can say so, rather than an escaping
    // exception that would surface as a blank screen.
    return { status: "failed", message: describeError(error) };
  }
}
