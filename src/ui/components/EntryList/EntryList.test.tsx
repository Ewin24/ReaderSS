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
});
