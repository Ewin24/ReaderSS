/**
 * Presentational contract only: what each state renders, and what the
 * controls emit. No services, no file reading, no store -- that is
 * `OpmlContainer.test.tsx`'s job.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/preact";
import { OpmlPanel, type OpmlPanelProps } from "./OpmlPanel";

const idle: OpmlPanelProps = {
  importState: { kind: "idle" },
  exportState: { kind: "idle" },
  onImportFile: vi.fn(),
  onExport: vi.fn(),
};

function renderPanel(overrides: Partial<OpmlPanelProps> = {}) {
  return render(<OpmlPanel {...idle} {...overrides} />);
}

/** jsdom's file input is read-only, so the FileList is installed directly. */
function chooseFile(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  fireEvent.change(input);
}

function fileInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("no file input rendered");
  return input;
}

describe("OpmlPanel", () => {
  it("is a labelled region with both actions", () => {
    renderPanel();

    expect(screen.getByRole("region", { name: /subscription list \(opml\)/i })).toBeInTheDocument();
    expect(fileInput()).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /export opml/i })).toBeInTheDocument();
  });

  it("states plainly that OPML carries subscriptions only", () => {
    renderPanel();

    expect(screen.getByText(/no entries, read state, or stars/i)).toBeInTheDocument();
  });

  it("emits the chosen file", () => {
    const onImportFile = vi.fn();
    renderPanel({ onImportFile });
    const file = new File(["<opml/>"], "subs.opml", { type: "text/x-opml" });

    chooseFile(fileInput(), file);

    expect(onImportFile).toHaveBeenCalledWith(file);
  });

  it("clears the input value so re-choosing the SAME file still fires", () => {
    renderPanel();
    const input = fileInput();

    chooseFile(input, new File(["<opml/>"], "subs.opml"));

    expect(input.value).toBe("");
  });

  it("emits nothing when the picker is dismissed with no file", () => {
    const onImportFile = vi.fn();
    renderPanel({ onImportFile });
    const input = fileInput();
    Object.defineProperty(input, "files", { value: [], configurable: true });

    fireEvent.change(input);

    expect(onImportFile).not.toHaveBeenCalled();
  });

  it("shows live progress while importing, and offers Cancel", () => {
    const onCancelImport = vi.fn();
    renderPanel({
      importState: { kind: "importing", done: 12, total: 40 },
      onCancelImport,
    });

    expect(screen.getByText(/subscribing to feed 12 of 40/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /cancel import/i }));
    expect(onCancelImport).toHaveBeenCalled();
  });

  it("disables both actions while an import is running", () => {
    renderPanel({ importState: { kind: "importing", done: 1, total: 3 } });

    expect(fileInput()).toBeDisabled();
    expect(screen.getByRole("button", { name: /export opml/i })).toBeDisabled();
  });

  it("offers no Cancel control when no cancel handler was supplied", () => {
    renderPanel({
      importState: { kind: "importing", done: 1, total: 3 },
      onCancelImport: undefined,
    });

    expect(screen.queryByRole("button", { name: /cancel import/i })).not.toBeInTheDocument();
  });

  it("summarizes a finished import and names ONLY the feeds that had a problem", () => {
    renderPanel({
      importState: {
        kind: "done",
        summary: { added: 2, duplicates: 1, failed: 1, cancelled: 0 },
        outcomes: [
          { url: "https://a.test/f.xml", title: "Added one", status: "subscribed" },
          { url: "https://b.test/f.xml", title: "Known one", status: "duplicate" },
          { url: "https://c.test/f.xml", title: "Broken one", status: "unreachable" },
        ],
      },
    });

    expect(screen.getByText(/2 added, 1 already subscribed, 1 failed/i)).toBeInTheDocument();
    expect(screen.getByText("Broken one")).toBeInTheDocument();
    // Successes are not listed: they need no explanation.
    expect(screen.queryByText("Added one")).not.toBeInTheDocument();
    expect(screen.queryByText("Known one")).not.toBeInTheDocument();
  });

  it("mentions skipped feeds in the summary only when there were any", () => {
    const outcomes = [{ url: "https://a.test/f.xml", title: "A", status: "cancelled" as const }];
    const { rerender } = renderPanel({
      importState: {
        kind: "done",
        summary: { added: 0, duplicates: 0, failed: 0, cancelled: 1 },
        outcomes,
      },
    });
    expect(screen.getByText(/1 skipped/i)).toBeInTheDocument();

    rerender(
      <OpmlPanel
        {...idle}
        importState={{
          kind: "done",
          summary: { added: 1, duplicates: 0, failed: 0, cancelled: 0 },
          outcomes: [{ url: "https://a.test/f.xml", title: "A", status: "subscribed" }],
        }}
      />,
    );
    expect(screen.queryByText(/skipped/i)).not.toBeInTheDocument();
  });

  it("falls back to the URL when a problem feed has no title", () => {
    renderPanel({
      importState: {
        kind: "done",
        summary: { added: 0, duplicates: 0, failed: 1, cancelled: 0 },
        outcomes: [{ url: "https://c.test/f.xml", title: null, status: "not-a-feed" }],
      },
    });

    expect(screen.getByText("https://c.test/f.xml")).toBeInTheDocument();
    expect(screen.getByText(/no feed found there/i)).toBeInTheDocument();
  });

  it("shows an import error message", () => {
    renderPanel({ importState: { kind: "error", message: "That file could not be read as OPML." } });

    expect(screen.getByText(/could not be read as opml/i)).toBeInTheDocument();
  });

  it("reports the export outcome, singular and plural", () => {
    const { rerender } = renderPanel({ exportState: { kind: "done", feedCount: 1 } });
    expect(screen.getByText(/exported 1 subscription\./i)).toBeInTheDocument();

    rerender(<OpmlPanel {...idle} exportState={{ kind: "done", feedCount: 4 }} />);
    expect(screen.getByText(/exported 4 subscriptions\./i)).toBeInTheDocument();
  });

  it("announces outcomes through a live region", () => {
    renderPanel({ exportState: { kind: "done", feedCount: 2 } });

    expect(screen.getByRole("status")).toHaveTextContent(/exported 2 subscriptions/i);
  });

  it("emits an export request", () => {
    const onExport = vi.fn();
    renderPanel({ onExport });

    fireEvent.click(screen.getByRole("button", { name: /export opml/i }));

    expect(onExport).toHaveBeenCalled();
  });
});
