import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/preact";
import { App } from "./App";
import type { AppEntry, AppFeed } from "./types";

const feeds: AppFeed[] = [
  { id: "feed-1", title: "Hacker News", folder: null },
  { id: "feed-2", title: "Ars Technica", folder: "Tech" },
];

const entries: AppEntry[] = [
  {
    id: "entry-1",
    feedId: "feed-1",
    title: "IndexedDB in practice",
    publishedAt: "2026-08-18T09:00:00.000Z",
    read: 0,
    starred: 1,
    link: "https://example.com/1",
    summary: null,
    content: "Full article body.",
  },
  {
    id: "entry-2",
    feedId: "feed-2",
    title: "Service worker gotchas",
    publishedAt: "2026-08-17T09:00:00.000Z",
    read: 0,
    starred: 0,
    link: "https://example.com/2",
    summary: null,
    content: "Another article body.",
  },
];

function stubMatchMedia(matches: boolean) {
  // vi.stubGlobal (not a direct `window.matchMedia = ...` assignment) so the
  // afterEach's vi.unstubAllGlobals() actually reverts to setup.ts's default
  // stub between tests, instead of being a no-op that silently leaves the
  // previous test's mock in place.
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("App", () => {
  it("renders the feed sidebar, entry list, and reading pane landmarks", () => {
    stubMatchMedia(true);
    render(<App feeds={feeds} entries={entries} />);

    expect(screen.getByRole("navigation", { name: "Feeds" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Entries" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Reading pane" })).toBeInTheDocument();
  });

  describe("responsive layout", () => {
    it("shows both the entry list and the reading pane at once on a wide viewport", () => {
      stubMatchMedia(true);
      render(<App feeds={feeds} entries={entries} />);

      fireEvent.click(screen.getByRole("button", { name: /indexeddb in practice/i }));

      expect(screen.getByRole("list", { name: "Entries" })).toBeInTheDocument();
      expect(screen.getByRole("region", { name: "Reading pane" })).toBeInTheDocument();
    });

    it("shows only one of the entry list or the reading pane at a time on a narrow viewport", () => {
      stubMatchMedia(false);
      render(<App feeds={feeds} entries={entries} />);

      expect(screen.getByRole("list", { name: "Entries" })).toBeInTheDocument();
      expect(screen.queryByRole("region", { name: "Reading pane" })).not.toBeInTheDocument();
    });

    it("navigates to the reading pane on selection and back to the list via an explicit control", () => {
      stubMatchMedia(false);
      render(<App feeds={feeds} entries={entries} />);

      fireEvent.click(screen.getByRole("button", { name: /indexeddb in practice/i }));

      expect(screen.queryByRole("list", { name: "Entries" })).not.toBeInTheDocument();
      expect(screen.getByRole("region", { name: "Reading pane" })).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: /back/i }));

      expect(screen.getByRole("list", { name: "Entries" })).toBeInTheDocument();
      expect(screen.queryByRole("region", { name: "Reading pane" })).not.toBeInTheDocument();
    });

    it("moves focus to the reading pane heading after navigating to it on a narrow viewport", () => {
      stubMatchMedia(false);
      render(<App feeds={feeds} entries={entries} />);

      fireEvent.click(screen.getByRole("button", { name: /indexeddb in practice/i }));

      expect(document.activeElement).toBe(
        screen.getByRole("heading", { name: /indexeddb in practice/i }),
      );
    });

    it("returns focus to the previously selected entry after navigating back to the list on a narrow viewport", () => {
      stubMatchMedia(false);
      render(<App feeds={feeds} entries={entries} />);

      fireEvent.click(screen.getByRole("button", { name: /indexeddb in practice/i }));
      fireEvent.click(screen.getByRole("button", { name: /back/i }));

      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: /indexeddb in practice/i }),
      );
    });
  });

  describe("selection", () => {
    it("selecting an entry marks it current in the list and renders it in the reading pane", () => {
      stubMatchMedia(true);
      render(<App feeds={feeds} entries={entries} />);

      fireEvent.click(screen.getByRole("button", { name: /indexeddb in practice/i }));

      expect(
        screen.getByRole("button", { name: /indexeddb in practice/i }),
      ).toHaveAttribute("aria-current", "true");
      expect(
        screen.getByRole("heading", { name: /indexeddb in practice/i }),
      ).toBeInTheDocument();
    });

    it("switching feeds clears the previous entry selection", () => {
      stubMatchMedia(true);
      render(<App feeds={feeds} entries={entries} />);

      fireEvent.click(screen.getByRole("button", { name: /indexeddb in practice/i }));
      fireEvent.click(screen.getByRole("button", { name: /ars technica/i }));

      expect(screen.getByText(/select an entry/i)).toBeInTheDocument();
    });
  });

  describe("empty states", () => {
    it("shows an explicit empty state when there are no feeds", () => {
      stubMatchMedia(true);
      render(<App feeds={[]} entries={[]} />);

      expect(screen.getByText(/no feeds yet/i)).toBeInTheDocument();
      expect(screen.getByText(/select an entry/i)).toBeInTheDocument();
    });

    it("shows an explicit empty state when the selected feed has no entries", () => {
      stubMatchMedia(true);
      render(<App feeds={feeds} entries={[]} />);

      expect(screen.getByText(/this feed has no entries yet/i)).toBeInTheDocument();
    });
  });
});
