import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/preact";
import { EntryList } from "./EntryList";

const entries = [
  {
    id: "entry-1",
    title: "First entry",
    feedTitle: "Hacker News",
    publishedAt: "2026-08-19T09:00:00.000Z",
    read: 0 as const,
    starred: 0 as const,
  },
  {
    id: "entry-2",
    title: "Second entry",
    feedTitle: "Hacker News",
    publishedAt: "2026-08-18T09:00:00.000Z",
    read: 1 as const,
    starred: 0 as const,
  },
];

describe("EntryList", () => {
  it("renders entries as an accessible list", () => {
    render(
      <EntryList entries={entries} selectedEntryId={null} onSelectEntry={vi.fn()} />,
    );

    const list = screen.getByRole("list", { name: "Entries" });
    expect(list).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("calls onSelectEntry when an entry is activated", () => {
    const onSelectEntry = vi.fn();
    render(
      <EntryList entries={entries} selectedEntryId={null} onSelectEntry={onSelectEntry} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /first entry/i }));

    expect(onSelectEntry).toHaveBeenCalledWith("entry-1");
  });

  it("shows an explicit empty state explaining the next action when there are no entries", () => {
    render(
      <EntryList
        entries={[]}
        selectedEntryId={null}
        onSelectEntry={vi.fn()}
        emptyMessage="This feed has no entries yet."
      />,
    );

    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.getByText("This feed has no entries yet.")).toBeInTheDocument();
  });

  it("threads onToggleRead/onToggleStar through to each row", () => {
    const onToggleRead = vi.fn();
    const onToggleStar = vi.fn();
    render(
      <EntryList
        entries={entries}
        selectedEntryId={null}
        onSelectEntry={vi.fn()}
        onToggleRead={onToggleRead}
        onToggleStar={onToggleStar}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: 'Mark "First entry" as read' }));
    expect(onToggleRead).toHaveBeenCalledWith("entry-1");

    fireEvent.click(screen.getByRole("button", { name: 'Star "Second entry"' }));
    expect(onToggleStar).toHaveBeenCalledWith("entry-2");
  });

  describe("pagination footer and scroll-end", () => {
    it("fires onScrollEnd when a scroll reaches the viewport end", () => {
      const onScrollEnd = vi.fn();
      const { container } = render(
        <EntryList entries={entries} selectedEntryId={null} onSelectEntry={vi.fn()} onScrollEnd={onScrollEnd} />,
      );

      const list = container.querySelector("ul.entry-list") as HTMLElement;
      Object.defineProperty(list, "clientHeight", { value: 50, configurable: true });
      Object.defineProperty(list, "scrollHeight", { value: 100, configurable: true });

      fireEvent.scroll(list, { target: { scrollTop: 50 } });
      expect(onScrollEnd).toHaveBeenCalledTimes(1);
    });

    it("does not fire onScrollEnd when the scroll is not at the end", () => {
      const onScrollEnd = vi.fn();
      const { container } = render(
        <EntryList entries={entries} selectedEntryId={null} onSelectEntry={vi.fn()} onScrollEnd={onScrollEnd} />,
      );

      const list = container.querySelector("ul.entry-list") as HTMLElement;
      Object.defineProperty(list, "clientHeight", { value: 50, configurable: true });
      Object.defineProperty(list, "scrollHeight", { value: 100, configurable: true });

      fireEvent.scroll(list, { target: { scrollTop: 10 } });
      expect(onScrollEnd).not.toHaveBeenCalled();
    });

    it("does NOT auto-advance on scroll when the page does not overflow the container (short page)", () => {
      const onScrollEnd = vi.fn();
      const { container } = render(
        <EntryList entries={entries} selectedEntryId={null} onSelectEntry={vi.fn()} onScrollEnd={onScrollEnd} />,
      );

      const list = container.querySelector("ul.entry-list") as HTMLElement;
      // Content fits (or is shorter than) the viewport → no real overflow to scroll.
      Object.defineProperty(list, "clientHeight", { value: 50, configurable: true });
      Object.defineProperty(list, "scrollHeight", { value: 50, configurable: true });

      fireEvent.scroll(list, { target: { scrollTop: 0 } });
      expect(onScrollEnd).not.toHaveBeenCalled();
    });

    it("advances at the real end of a long overflowing page", () => {
      const onScrollEnd = vi.fn();
      const { container } = render(
        <EntryList entries={entries} selectedEntryId={null} onSelectEntry={vi.fn()} onScrollEnd={onScrollEnd} />,
      );

      const list = container.querySelector("ul.entry-list") as HTMLElement;
      // Long page: content overflows the viewport and the user is at the bottom.
      Object.defineProperty(list, "clientHeight", { value: 50, configurable: true });
      Object.defineProperty(list, "scrollHeight", { value: 100, configurable: true });

      fireEvent.scroll(list, { target: { scrollTop: 50 } });
      expect(onScrollEnd).toHaveBeenCalledTimes(1);
    });

    it("resets scrollTop to 0 when the page changes", () => {
      const { container, rerender } = render(
        <EntryList
          entries={entries}
          selectedEntryId={null}
          onSelectEntry={vi.fn()}
          page={1}
          pageCount={3}
          onPrevPage={vi.fn()}
          onNextPage={vi.fn()}
        />,
      );

      const list = container.querySelector("ul.entry-list") as HTMLElement;
      list.scrollTop = 120;
      expect(list.scrollTop).toBe(120);

      rerender(
        <EntryList
          entries={entries}
          selectedEntryId={null}
          onSelectEntry={vi.fn()}
          page={2}
          pageCount={3}
          onPrevPage={vi.fn()}
          onNextPage={vi.fn()}
        />,
      );

      expect(list.scrollTop).toBe(0);
    });

    it("renders a footer with 'Page X of Y' and disabled prev at page 1", () => {
      render(
        <EntryList
          entries={entries}
          selectedEntryId={null}
          onSelectEntry={vi.fn()}
          page={1}
          pageCount={3}
          onPrevPage={vi.fn()}
          onNextPage={vi.fn()}
        />,
      );

      expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /previous page/i })).toBeDisabled();
      expect(screen.getByRole("button", { name: /next page/i })).toBeEnabled();
    });

    it("disables next on the last page", () => {
      render(
        <EntryList
          entries={entries}
          selectedEntryId={null}
          onSelectEntry={vi.fn()}
          page={3}
          pageCount={3}
          onPrevPage={vi.fn()}
          onNextPage={vi.fn()}
        />,
      );

      expect(screen.getByText("Page 3 of 3")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /previous page/i })).toBeEnabled();
      expect(screen.getByRole("button", { name: /next page/i })).toBeDisabled();
    });

    it("hides the pagination footer entirely when there is only one page", () => {
      render(
        <EntryList
          entries={entries}
          selectedEntryId={null}
          onSelectEntry={vi.fn()}
          page={1}
          pageCount={1}
          onPrevPage={vi.fn()}
          onNextPage={vi.fn()}
        />,
      );

      expect(screen.queryByText(/page \d+ of \d+/i)).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /previous page/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /next page/i })).not.toBeInTheDocument();
    });

    it("fires onPrevPage/onNextPage on their buttons", () => {
      const onPrevPage = vi.fn();
      const onNextPage = vi.fn();
      render(
        <EntryList
          entries={entries}
          selectedEntryId={null}
          onSelectEntry={vi.fn()}
          page={2}
          pageCount={3}
          onPrevPage={onPrevPage}
          onNextPage={onNextPage}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: /previous page/i }));
      expect(onPrevPage).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByRole("button", { name: /next page/i }));
      expect(onNextPage).toHaveBeenCalledTimes(1);
    });

    it("omits the footer when not paginated (no page/pageCount props)", () => {
      render(<EntryList entries={entries} selectedEntryId={null} onSelectEntry={vi.fn()} />);

      expect(screen.queryByText(/page \d+ of \d+/i)).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /next page/i })).not.toBeInTheDocument();
    });
  });
});
