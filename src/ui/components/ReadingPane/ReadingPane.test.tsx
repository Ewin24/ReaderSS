import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/preact";
import { ReadingPane } from "./ReadingPane";

const baseEntry = {
  id: "entry-1",
  title: "IndexedDB in practice",
  feedTitle: "Hacker News",
  publishedAt: "2026-08-19T09:00:00.000Z",
  link: "https://example.com/indexeddb-in-practice",
};

describe("ReadingPane", () => {
  it("is a landmark region", () => {
    render(<ReadingPane entry={null} />);

    expect(screen.getByRole("region", { name: "Reading pane" })).toBeInTheDocument();
  });

  it("shows an explicit empty state when no entry is selected", () => {
    render(<ReadingPane entry={null} />);

    expect(screen.getByText(/select an entry/i)).toBeInTheDocument();
  });

  it("renders full content and still links to the original article", () => {
    render(
      <ReadingPane
        entry={{ ...baseEntry, summary: "A short summary.", content: "The full article body." }}
      />,
    );

    expect(screen.getByRole("heading", { name: /indexeddb in practice/i })).toBeInTheDocument();
    expect(screen.getByText("The full article body.")).toBeInTheDocument();
    expect(screen.queryByText(/this is a summary/i)).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /read the original article/i }),
    ).toHaveAttribute("href", baseEntry.link);
  });

  it("labels summary-only content as partial, without an ellipsis, and links to the original", () => {
    render(
      <ReadingPane entry={{ ...baseEntry, summary: "A short summary.", content: null }} />,
    );

    expect(screen.getByText(/this is a summary/i)).toBeInTheDocument();
    expect(screen.getByText("A short summary.")).toBeInTheDocument();
    expect(screen.queryByText(/…$/)).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /read the original article/i }),
    ).toHaveAttribute("href", baseEntry.link);
  });

  it("states plainly when the feed provided no content and still offers the original link", () => {
    render(<ReadingPane entry={{ ...baseEntry, summary: null, content: null }} />);

    expect(screen.getByText(/no content/i)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /read the original article/i }),
    ).toHaveAttribute("href", baseEntry.link);
  });

  it("omits the original-article link when the feed-supplied link uses a disallowed scheme", () => {
    render(
      <ReadingPane
        entry={{
          ...baseEntry,
          link: "javascript:alert(1)",
          summary: null,
          content: "Body",
        }}
      />,
    );

    expect(
      screen.queryByRole("link", { name: /read the original article/i }),
    ).not.toBeInTheDocument();
  });

  it("calls onBack when the back control is activated", () => {
    const onBack = vi.fn();
    render(
      <ReadingPane entry={{ ...baseEntry, summary: null, content: "Body" }} onBack={onBack} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /back/i }));

    expect(onBack).toHaveBeenCalled();
  });
});
