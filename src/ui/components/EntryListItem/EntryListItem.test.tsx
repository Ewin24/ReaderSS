import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/preact";
import { EntryListItem, type EntryListItemData } from "./EntryListItem";

const entry: EntryListItemData = {
  id: "entry-1",
  title: "IndexedDB in practice",
  feedTitle: "Hacker News",
  publishedAt: "2026-08-19T09:00:00.000Z",
  read: 0,
  starred: 1,
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

    expect(screen.getByRole("button", { name: /indexeddb in practice/i })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  describe("read/unread and star toggles (Amendment C)", () => {
    function renderWithToggles(overrides: Partial<typeof entry> = {}) {
      const onSelect = vi.fn();
      const onToggleRead = vi.fn();
      const onToggleStar = vi.fn();
      render(
        <ul>
          <EntryListItem
            entry={{ ...entry, ...overrides }}
            selected={false}
            onSelect={onSelect}
            onToggleRead={onToggleRead}
            onToggleStar={onToggleStar}
          />
        </ul>,
      );
      return { onSelect, onToggleRead, onToggleStar };
    }

    it("does not render toggle controls when no toggle handler is provided (backward compatible)", () => {
      renderItem();

      expect(screen.queryByRole("button", { name: /mark.*as (read|unread)/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^(star|unstar)/i })).not.toBeInTheDocument();
    });

    it("exposes a read/unread toggle with an accessible name naming both the entry and its current state", () => {
      renderWithToggles({ read: 0 });

      expect(
        screen.getByRole("button", { name: 'Mark "IndexedDB in practice" as read' }),
      ).toBeInTheDocument();
    });

    it("calls onToggleRead with the entry id when the read toggle is activated, without triggering onSelect", () => {
      const { onToggleRead, onSelect } = renderWithToggles({ read: 0 });

      fireEvent.click(screen.getByRole("button", { name: 'Mark "IndexedDB in practice" as read' }));

      expect(onToggleRead).toHaveBeenCalledWith("entry-1");
      expect(onSelect).not.toHaveBeenCalled();
    });

    it("flips the read toggle's accessible name and aria-pressed to reflect the read entry", () => {
      renderWithToggles({ read: 1 });

      const button = screen.getByRole("button", { name: 'Mark "IndexedDB in practice" as unread' });
      expect(button).toHaveAttribute("aria-pressed", "true");
    });

    it("exposes a star/unstar toggle with an accessible name naming both the entry and its current state", () => {
      renderWithToggles({ starred: 0 });

      expect(screen.getByRole("button", { name: 'Star "IndexedDB in practice"' })).toBeInTheDocument();
    });

    it("calls onToggleStar with the entry id when the star toggle is activated, without triggering onSelect", () => {
      const { onToggleStar, onSelect } = renderWithToggles({ starred: 0 });

      fireEvent.click(screen.getByRole("button", { name: 'Star "IndexedDB in practice"' }));

      expect(onToggleStar).toHaveBeenCalledWith("entry-1");
      expect(onSelect).not.toHaveBeenCalled();
    });

    it("flips the star toggle's accessible name and aria-pressed to reflect the starred entry", () => {
      renderWithToggles({ starred: 1 });

      const button = screen.getByRole("button", { name: 'Unstar "IndexedDB in practice"' });
      expect(button).toHaveAttribute("aria-pressed", "true");
    });
  });
});
