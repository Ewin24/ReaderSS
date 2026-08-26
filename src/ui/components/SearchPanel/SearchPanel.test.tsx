import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/preact";
import type { SearchResult } from "../../../domain/search/librarySearch";
import { SearchPanel, type SearchPanelProps } from "./SearchPanel";

function entryResult(overrides: Partial<Extract<SearchResult, { kind: "entry" }>> = {}) {
  return {
    kind: "entry" as const,
    entryId: "e1",
    feedId: "feed-1",
    feedTitle: "Hacker News",
    title: "Kafka in practice",
    publishedAt: "2026-08-01T00:00:00.000Z",
    matchedIn: "title" as const,
    snippet: { before: "Reading the ", match: "Kafka", after: " logs" },
    ...overrides,
  };
}

function feedResult(overrides: Partial<Extract<SearchResult, { kind: "feed" }>> = {}) {
  return {
    kind: "feed" as const,
    feedId: "feed-1",
    feedTitle: "Hacker News",
    matchedIn: "title" as const,
    snippet: { before: "", match: "Hacker", after: " News" },
    ...overrides,
  };
}

function renderPanel(props: Partial<SearchPanelProps> = {}) {
  const onQueryChange = vi.fn();
  const onSelectResult = vi.fn();
  const onClear = vi.fn();

  render(
    <SearchPanel
      query=""
      onQueryChange={onQueryChange}
      status="idle"
      results={[]}
      totalCount={0}
      errorMessage={null}
      onSelectResult={onSelectResult}
      onClear={onClear}
      {...props}
    />,
  );

  return { onQueryChange, onSelectResult, onClear };
}

describe("SearchPanel — the box", () => {
  it("labels the input, so it is reachable by name", () => {
    renderPanel();

    expect(screen.getByRole("searchbox", { name: /search your feeds/i })).toBeInTheDocument();
  });

  it("reports what you type", () => {
    const { onQueryChange } = renderPanel();

    fireEvent.input(screen.getByRole("searchbox"), { target: { value: "kafka" } });

    expect(onQueryChange).toHaveBeenCalledWith("kafka");
  });

  it("offers Clear only once there is something to clear", () => {
    renderPanel();
    expect(screen.queryByRole("button", { name: "Clear" })).not.toBeInTheDocument();

    renderPanel({ query: "kafka" });
    expect(screen.getByRole("button", { name: "Clear" })).toBeInTheDocument();
  });

  it("clears on request", () => {
    const { onClear } = renderPanel({ query: "kafka" });

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));

    expect(onClear).toHaveBeenCalledTimes(1);
  });
});

describe("SearchPanel — results", () => {
  it("shows the text around the match, with the match marked", () => {
    renderPanel({ query: "kafka", status: "done", results: [entryResult()], totalCount: 1 });

    // The three snippet pieces are rendered as elements, never as markup.
    expect(screen.getByText("Kafka").tagName).toBe("MARK");
    expect(screen.getByText(/Reading the/)).toBeInTheDocument();
    expect(screen.getByText(/logs/)).toBeInTheDocument();
  });

  it("says which feed an article came from, and when", () => {
    renderPanel({ query: "kafka", status: "done", results: [entryResult()], totalCount: 1 });

    expect(screen.getByText("Hacker News")).toBeInTheDocument();
    expect(screen.getByText("2026-08-01")).toBeInTheDocument();
  });

  it("names each row for assistive technology, including where it matched", () => {
    renderPanel({
      query: "kafka",
      status: "done",
      results: [entryResult({ matchedIn: "body" })],
      totalCount: 1,
    });

    expect(
      screen.getByRole("button", {
        name: "Kafka in practice, in Hacker News, matched in the text",
      }),
    ).toBeInTheDocument();
  });

  it("hands the whole result back when a row is clicked", () => {
    const result = entryResult();
    const { onSelectResult } = renderPanel({
      query: "kafka",
      status: "done",
      results: [result],
      totalCount: 1,
    });

    fireEvent.click(screen.getByRole("button", { name: /kafka in practice/i }));

    expect(onSelectResult).toHaveBeenCalledWith(result);
  });

  it("tells a feed result apart from an article result", () => {
    renderPanel({
      query: "hacker",
      status: "done",
      results: [feedResult(), entryResult()],
      totalCount: 2,
    });

    expect(screen.getByRole("button", { name: "Feed: Hacker News" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Kafka in practice,/ })).toBeInTheDocument();
  });

  it("says when a feed matched through your note rather than its title", () => {
    renderPanel({
      query: "rust",
      status: "done",
      results: [feedResult({ matchedIn: "note", snippet: { before: "", match: "Rust", after: " things" } })],
      totalCount: 1,
    });

    expect(
      screen.getByRole("button", { name: "Feed: Hacker News, matched in your note" }),
    ).toBeInTheDocument();
  });
});

describe("SearchPanel — saying how it went", () => {
  it("says it is searching", () => {
    renderPanel({ query: "kafka", status: "searching" });

    expect(screen.getByRole("status")).toHaveTextContent("Searching…");
  });

  it("says plainly when nothing matched", () => {
    // Silence here reads as "still working", which is a different answer.
    renderPanel({ query: "kafka", status: "done", results: [], totalCount: 0 });

    expect(screen.getByRole("status")).toHaveTextContent("No matches.");
  });

  it("counts the matches", () => {
    renderPanel({ query: "kafka", status: "done", results: [entryResult()], totalCount: 1 });

    expect(screen.getByRole("status")).toHaveTextContent("1 match.");
  });

  it("says out loud when it is showing only part of what it found", () => {
    // A capped list that presents itself as the whole answer is a quiet lie.
    renderPanel({
      query: "kafka",
      status: "done",
      results: [entryResult(), entryResult({ entryId: "e2" })],
      totalCount: 57,
    });

    expect(screen.getByRole("status")).toHaveTextContent(
      "Showing the first 2 of 57 matches. Narrow the search to see the rest.",
    );
  });

  it("reports a failed search as an alert, and only once", () => {
    renderPanel({ query: "kafka", status: "error", errorMessage: "IndexedDB is gone" });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "The search could not be run. IndexedDB is gone",
    );
    // The status line stays quiet rather than repeating the alert.
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("says nothing at all before a search has been run", () => {
    renderPanel();

    expect(screen.getByRole("status")).toHaveTextContent("");
    expect(screen.queryByRole("list", { name: "Search results" })).not.toBeInTheDocument();
  });
});
