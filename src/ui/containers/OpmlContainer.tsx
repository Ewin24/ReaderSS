/**
 * Binds `OpmlPanel` to the `importOpml`/`exportOpml` services via the
 * services context, and owns the two things a presentational component must
 * not: reading the chosen file's text, and handing the browser a file to
 * save.
 *
 * Mounted from `App.tsx` inside the settings row (see the composition comment
 * there), alongside `SettingsPanel`.
 */
import { useCallback, useRef, useState } from "preact/hooks";
import { useServices } from "../../app/providers/ServicesContext";
import { describeError } from "../../domain/errors/describeError";
import { exportOpml } from "../../services/exportOpml";
import { importOpml } from "../../services/importOpml";
import {
  OpmlPanel,
  type OpmlExportState,
  type OpmlImportState,
} from "../components/OpmlPanel";
import { downloadTextFile } from "../downloadTextFile";

export interface OpmlContainerProps {
  /** Called after an import that added at least one feed, so the sidebar and
   * entry list can pick the new subscriptions up. */
  readonly onImported?: () => void;
}

const OPML_FILENAME = "readerss-subscriptions.opml";
const OPML_MIME_TYPE = "text/x-opml";

export function OpmlContainer({ onImported }: OpmlContainerProps) {
  const services = useServices();
  const [importState, setImportState] = useState<OpmlImportState>({ kind: "idle" });
  const [exportState, setExportState] = useState<OpmlExportState>({ kind: "idle" });
  const abortRef = useRef<AbortController | null>(null);

  const handleImportFile = useCallback(
    (file: File) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setExportState({ kind: "idle" });
      setImportState({ kind: "reading" });

      void (async () => {
        let xml: string;
        try {
          xml = await file.text();
        } catch (error: unknown) {
          // A file the browser can no longer read (removed from disk, or a
          // permission revoked mid-pick) rejects here rather than producing
          // empty text, so it is reported instead of importing nothing.
          setImportState({ kind: "error", message: describeError(error) });
          abortRef.current = null;
          return;
        }

        const result = await importOpml(services, xml, {
          signal: controller.signal,
          onProgress: (done, total) => setImportState({ kind: "importing", done, total }),
        });
        abortRef.current = null;

        if (result.status === "invalid-file") {
          setImportState({
            kind: "error",
            message: `That file could not be read as OPML (${result.message}).`,
          });
          return;
        }
        if (result.status === "no-feeds") {
          setImportState({ kind: "error", message: "That OPML file lists no feeds." });
          return;
        }

        setImportState({
          kind: "done",
          summary: result.summary,
          outcomes: result.outcomes.map((outcome) => ({
            url: outcome.url,
            title: outcome.title,
            status: outcome.status,
          })),
        });
        if (result.summary.added > 0) onImported?.();
      })();
    },
    [services, onImported],
  );

  const handleCancelImport = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleExport = useCallback(() => {
    setImportState({ kind: "idle" });
    setExportState({ kind: "exporting" });

    void (async () => {
      const result = await exportOpml(services);
      if (result.status === "failed") {
        setExportState({
          kind: "error",
          message: `Could not read your subscriptions (${result.message}).`,
        });
        return;
      }

      try {
        downloadTextFile({
          filename: OPML_FILENAME,
          text: result.xml,
          mimeType: OPML_MIME_TYPE,
        });
      } catch (error: unknown) {
        // The document was built fine; only handing it to the browser failed.
        // Said plainly rather than reported as an export failure, because the
        // two have different causes and different fixes.
        setExportState({
          kind: "error",
          message: `Your subscriptions were exported, but the download could not start (${describeError(error)}).`,
        });
        return;
      }

      setExportState({ kind: "done", feedCount: result.feedCount });
    })();
  }, [services]);

  return (
    <OpmlPanel
      importState={importState}
      exportState={exportState}
      onImportFile={handleImportFile}
      onCancelImport={handleCancelImport}
      onExport={handleExport}
    />
  );
}
