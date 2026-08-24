/**
 * Import/export of an OPML subscription list. Presentational only: it takes
 * state in and emits the chosen file / a click out. Reading the file,
 * subscribing, and building the download all belong to `OpmlContainer`.
 *
 * WHAT IT REPORTS, and why it is shaped this way: an import of 40 feeds
 * produces 40 outcomes, and dumping all of them is noise -- almost all of
 * them succeeded. The summary carries the counts, and the list below it names
 * ONLY the feeds that did not get added, because those are the ones the user
 * may want to chase. Successes need no explanation.
 */

/**
 * These prop types are declared HERE rather than imported from
 * `services/importOpml`: `ui/components/**` is presentational-only and may
 * not import `services/**` (enforced by `eslint.config.js`). The container
 * maps the service's result onto this shape, which is also what keeps this
 * component renderable from a test with no services at all.
 */
export type OpmlOutcomeStatus =
  | "subscribed"
  | "duplicate"
  | "invalid-url"
  | "not-a-feed"
  | "unreachable"
  | "relay-unavailable"
  | "too-large"
  | "persist-failed"
  | "cancelled";

export interface OpmlFeedOutcome {
  readonly url: string;
  readonly title: string | null;
  readonly status: OpmlOutcomeStatus;
}

export interface OpmlImportSummary {
  readonly added: number;
  readonly duplicates: number;
  readonly failed: number;
  readonly cancelled: number;
}

export type OpmlImportState =
  | { readonly kind: "idle" }
  | { readonly kind: "reading" }
  | { readonly kind: "importing"; readonly done: number; readonly total: number }
  | {
      readonly kind: "done";
      readonly summary: OpmlImportSummary;
      readonly outcomes: readonly OpmlFeedOutcome[];
    }
  | { readonly kind: "error"; readonly message: string };

export type OpmlExportState =
  | { readonly kind: "idle" }
  | { readonly kind: "exporting" }
  | { readonly kind: "done"; readonly feedCount: number }
  | { readonly kind: "error"; readonly message: string };

export interface OpmlPanelProps {
  readonly importState: OpmlImportState;
  readonly exportState: OpmlExportState;
  readonly onImportFile: (file: File) => void;
  /** No handler means no Cancel control, rather than one wired to nothing. */
  readonly onCancelImport?: () => void;
  readonly onExport: () => void;
}

/** Human wording for each `subscribeToFeed` outcome the import can report. */
const OUTCOME_LABELS: Record<OpmlOutcomeStatus, string> = {
  subscribed: "Added",
  duplicate: "Already subscribed",
  "invalid-url": "Not a valid URL",
  "not-a-feed": "No feed found there",
  unreachable: "Could not be reached",
  "relay-unavailable": "Feed relay isn't responding",
  "too-large": "Too large to fetch",
  "persist-failed": "Could not be saved",
  cancelled: "Skipped (cancelled)",
};

function isProblem(outcome: OpmlFeedOutcome): boolean {
  return outcome.status !== "subscribed" && outcome.status !== "duplicate";
}

function summaryText(summary: OpmlImportSummary): string {
  const parts = [
    `${summary.added} added`,
    `${summary.duplicates} already subscribed`,
    `${summary.failed} failed`,
  ];
  if (summary.cancelled > 0) parts.push(`${summary.cancelled} skipped`);
  return parts.join(", ");
}

function ImportStatus({ state }: { state: OpmlImportState }) {
  switch (state.kind) {
    case "idle":
      return null;
    case "reading":
      return <p class="opml-panel__status">Reading the file…</p>;
    case "importing":
      return (
        <p class="opml-panel__status">
          Subscribing to feed {state.done} of {state.total}…
        </p>
      );
    case "error":
      return (
        <p class="opml-panel__status opml-panel__status--error">{state.message}</p>
      );
    case "done": {
      const problems = state.outcomes.filter(isProblem);
      return (
        <div class="opml-panel__status">
          <p>{summaryText(state.summary)}.</p>
          {problems.length > 0 && (
            <ul class="opml-panel__problems">
              {problems.map((outcome) => (
                <li key={outcome.url}>
                  <span class="opml-panel__problem-title">{outcome.title ?? outcome.url}</span>
                  {" — "}
                  {OUTCOME_LABELS[outcome.status]}
                </li>
              ))}
            </ul>
          )}
        </div>
      );
    }
  }
}

function ExportStatus({ state }: { state: OpmlExportState }) {
  switch (state.kind) {
    case "idle":
    case "exporting":
      return null;
    case "error":
      return <p class="opml-panel__status opml-panel__status--error">{state.message}</p>;
    case "done":
      return (
        <p class="opml-panel__status">
          Exported {state.feedCount} {state.feedCount === 1 ? "subscription" : "subscriptions"}.
        </p>
      );
  }
}

export function OpmlPanel({
  importState,
  exportState,
  onImportFile,
  onCancelImport,
  onExport,
}: OpmlPanelProps) {
  const busy = importState.kind === "reading" || importState.kind === "importing";

  function handleFileChange(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    // Reset the input's value so choosing the SAME file again still fires a
    // change event -- otherwise a retry after a failed import does nothing.
    input.value = "";
    if (file) onImportFile(file);
  }

  return (
    <section class="opml-panel" aria-label="Subscription list (OPML)">
      <h3 class="opml-panel__title">Subscription list (OPML)</h3>
      <p class="opml-panel__hint">
        Import feeds from another reader, or export yours to move them elsewhere. Subscriptions
        only — an OPML file carries no entries, read state, or stars.
      </p>

      <div class="opml-panel__actions">
        <label class="opml-panel__import">
          <span>Import OPML</span>
          <input
            type="file"
            accept=".opml,.xml,application/xml,text/xml,text/x-opml"
            disabled={busy}
            onChange={handleFileChange}
          />
        </label>

        {busy && onCancelImport && (
          <button type="button" class="opml-panel__cancel" onClick={onCancelImport}>
            Cancel import
          </button>
        )}

        <button
          type="button"
          class="opml-panel__export"
          disabled={busy || exportState.kind === "exporting"}
          onClick={onExport}
        >
          Export OPML
        </button>
      </div>

      {/* One live region for both actions: only one of them ever runs at a
        * time (the controls disable each other), and a screen reader should
        * hear the outcome without having to go looking for it. */}
      <div class="opml-panel__feedback" role="status" aria-live="polite">
        <ImportStatus state={importState} />
        <ExportStatus state={exportState} />
      </div>
    </section>
  );
}
