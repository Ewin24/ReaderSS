import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/preact";
import { EntryListItem } from "./EntryListItem";

const entry = {
  id: "entry-1",
  title: "IndexedDB in practice",
  feedTitle: "Hacker News",
  publishedAt: "2026-08-19T09:00:00.000Z",
  read: 0 as const,
  starred: 1 as const,
};

function renderItem(overrides: Partial<typeof entry> = {}, selected = false) {
  const onSelect = vi.fn();
  render(
    <ul>
      <EntryListItem
        entry={{ ...entry, ...overrides }}
        selected={selected}
        onSelect={onSelect}
      />
    </ul>,
  );
  return { onSelect };
}

describe("EntryListItem", () => {
  it("renders as a list item containing a real button reachable by keyboard", () => {
    renderItem();

    const item = screen.getByRole("listitem");
    expect(item).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /indexeddb in practice/i }),
    ).toBeInTheDocument();
  });

  it("exposes title, source feed, published time, and read/starred state in its accessible name", () => {
    renderItem();

    const button = screen.getByRole("button", {
      name: /indexeddb in practice.*hacker news.*2026-08-19.*unread.*starred/i,
    });
    expect(button).toBeInTheDocument();
  });

  it("calls onSelect with the entry id when activated", () => {
    const { onSelect } = renderItem();

    fireEvent.click(screen.getByRole("button"));

    expect(onSelect).toHaveBeenCalledWith("entry-1");
  });

  it("marks the selected entry as current", () => {
    renderItem({}, true);

    expect(screen.getByRole("button")).toHaveAttribute("aria-current", "true");
  });
});
