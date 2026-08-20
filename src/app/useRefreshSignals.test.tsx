import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/preact";
import { useRefreshSignals } from "./useRefreshSignals";

/**
 * `App.tsx` used to own three independently-incrementing counters and
 * their bump handlers inline, and combined two of them into
 * `FeedSidebarContainer`'s `refreshSignal` prop
 * via a bare arithmetic sum (`sidebarRefreshSignal + feedListRefreshSignal`)
 * -- an implicit, undocumented "both are monotonic so summing never
 * collides" invariant. This hook extracts the bookkeeping into one place
 * with self-explanatory names, and exposes `feedSidebarSignal` as an
 * explicit two-element tuple instead of a summed number, so a consumer
 * depends on both versions directly rather than on an opaque combined
 * value. Exercised through a small harness component, the same pattern
 * this project already uses for hook-only behavior (no dedicated
 * `@testing-library/preact-hooks`-style package is installed).
 */
function Harness() {
  const signals = useRefreshSignals();
  return (
    <div>
      <output data-testid="feed-list-version">{signals.feedListVersion}</output>
      <output data-testid="entry-state-version">{signals.entryStateVersion}</output>
      <output data-testid="entries-version">{signals.entriesVersion}</output>
      <output data-testid="feed-sidebar-signal">{JSON.stringify(signals.feedSidebarSignal)}</output>
      <button type="button" onClick={signals.bumpFeedList}>
        bump feed list
      </button>
      <button type="button" onClick={signals.bumpEntryState}>
        bump entry state
      </button>
      <button type="button" onClick={signals.bumpEntries}>
        bump entries
      </button>
    </div>
  );
}

describe("useRefreshSignals", () => {
  it("starts every version at 0 and the combined feed-sidebar signal at [0, 0]", () => {
    render(<Harness />);

    expect(screen.getByTestId("feed-list-version")).toHaveTextContent("0");
    expect(screen.getByTestId("entry-state-version")).toHaveTextContent("0");
    expect(screen.getByTestId("entries-version")).toHaveTextContent("0");
    expect(screen.getByTestId("feed-sidebar-signal")).toHaveTextContent("[0,0]");
  });

  it("bumpFeedList advances only feedListVersion, reflected in the feed-sidebar signal's first slot", () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: /bump feed list/i }));

    expect(screen.getByTestId("feed-list-version")).toHaveTextContent("1");
    expect(screen.getByTestId("entry-state-version")).toHaveTextContent("0");
    expect(screen.getByTestId("entries-version")).toHaveTextContent("0");
    expect(screen.getByTestId("feed-sidebar-signal")).toHaveTextContent("[1,0]");
  });

  it("bumpEntryState advances only entryStateVersion, reflected in the feed-sidebar signal's second slot", () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: /bump entry state/i }));

    expect(screen.getByTestId("entry-state-version")).toHaveTextContent("1");
    expect(screen.getByTestId("feed-list-version")).toHaveTextContent("0");
    expect(screen.getByTestId("entries-version")).toHaveTextContent("0");
    expect(screen.getByTestId("feed-sidebar-signal")).toHaveTextContent("[0,1]");
  });

  it("bumpEntries advances only entriesVersion, independent of the feed-sidebar signal", () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: /bump entries/i }));

    expect(screen.getByTestId("entries-version")).toHaveTextContent("1");
    expect(screen.getByTestId("feed-list-version")).toHaveTextContent("0");
    expect(screen.getByTestId("entry-state-version")).toHaveTextContent("0");
    expect(screen.getByTestId("feed-sidebar-signal")).toHaveTextContent("[0,0]");
  });

  it("each bump is independent and cumulative across repeated clicks", () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: /bump feed list/i }));
    fireEvent.click(screen.getByRole("button", { name: /bump feed list/i }));
    fireEvent.click(screen.getByRole("button", { name: /bump entry state/i }));

    expect(screen.getByTestId("feed-list-version")).toHaveTextContent("2");
    expect(screen.getByTestId("entry-state-version")).toHaveTextContent("1");
    expect(screen.getByTestId("feed-sidebar-signal")).toHaveTextContent("[2,1]");
  });
});
