import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/preact";
import { ReadingPane, type ReadingPaneProps } from "./ReadingPane";
import { SanitizerContext, type SanitizeFn } from "../SafeHtml";

const baseEntry = {
  id: "entry-1",
  title: "IndexedDB in practice",
  feedTitle: "Hacker News",
  publishedAt: "2026-08-19T09:00:00.000Z",
  link: "https://example.com/indexeddb-in-practice",
  read: 0 as const,
  starred: 0 as const,
};

/**
 * The pane's body routes through `SafeHtml` (design.md §5), so
 * `useSanitizer()` throws unless a `SanitizerContext.Provider` is an
 * ancestor. This test file is not re-testing sanitization correctness --
 * that is `SafeHtml.test.tsx`'s job, with the real `DomPurifySanitizer` and
 * its enumerated malicious payload list -- so an identity function is
 * enough here to prove `ReadingPane` actually routes content through
 * `SafeHtml` rather than plain text interpolation.
 */
const identitySanitize: SanitizeFn = (html) => html;

function renderReadingPane(props: ReadingPaneProps) {
  return render(
    <SanitizerContext.Provider value={identitySanitize}>
      <ReadingPane {...props} />
    </SanitizerContext.Provider>,
  );
}

describe("ReadingPane", () => {
  it("is a landmark region", () => {
    renderReadingPane({ entry: null });

    expect(screen.getByRole("region", { name: "Reading pane" })).toBeInTheDocument();
  });

  it("shows an explicit empty state when no entry is selected", () => {
    renderReadingPane({ entry: null });

    expect(screen.getByText(/select an entry/i)).toBeInTheDocument();
  });

  it("renders full content and still links to the original article", () => {
    renderReadingPane({
      entry: { ...baseEntry, summary: "A short summary.", content: "The full article body." },
    });

    expect(screen.getByRole("heading", { name: /indexeddb in practice/i })).toBeInTheDocument();
    expect(screen.getByText("The full article body.")).toBeInTheDocument();
    expect(screen.queryByText(/this is a summary/i)).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /read the original article/i }),
    ).toHaveAttribute("href", baseEntry.link);
  });

  it("labels summary-only content as partial, without an ellipsis, and links to the original", () => {
    renderReadingPane({ entry: { ...baseEntry, summary: "A short summary.", content: null } });

    expect(screen.getByText(/this is a summary/i)).toBeInTheDocument();
    expect(screen.getByText("A short summary.")).toBeInTheDocument();
    expect(screen.queryByText(/…$/)).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /read the original article/i }),
    ).toHaveAttribute("href", baseEntry.link);
  });

  it("states plainly when the feed provided no content and still offers the original link", () => {
    renderReadingPane({ entry: { ...baseEntry, summary: null, content: null } });

    expect(screen.getByText(/no content/i)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /read the original article/i }),
    ).toHaveAttribute("href", baseEntry.link);
  });

  it("omits the original-article link when the feed-supplied link uses a disallowed scheme", () => {
    renderReadingPane({
      entry: {
        ...baseEntry,
        link: "javascript:alert(1)",
        summary: null,
        content: "Body",
      },
    });

    expect(
      screen.queryByRole("link", { name: /read the original article/i }),
    ).not.toBeInTheDocument();
  });

  it("calls onBack when the back control is activated", () => {
    const onBack = vi.fn();
    renderReadingPane({
      entry: { ...baseEntry, summary: null, content: "Body" },
      onBack,
    });

    fireEvent.click(screen.getByRole("button", { name: /back/i }));

    expect(onBack).toHaveBeenCalled();
  });

  describe("HTML rendering via the SafeHtml choke point", () => {
    it("renders HTML content as markup, not as an escaped literal string", () => {
      renderReadingPane({
        entry: { ...baseEntry, summary: null, content: "<strong>bold</strong> claim" },
      });

      const strong = screen.getByText("bold");
      expect(strong.tagName).toBe("STRONG");
      expect(screen.queryByText("<strong>bold</strong> claim")).not.toBeInTheDocument();
    });

    it("renders summary-only HTML as markup too, not just full content", () => {
      renderReadingPane({
        entry: { ...baseEntry, summary: "<em>partial</em> summary", content: null },
      });

      const em = screen.getByText("partial");
      expect(em.tagName).toBe("EM");
    });

    it("refuses to render body content at all when no SanitizerContext.Provider is present, rather than falling back to unsanitized output", () => {
      // SafeHtml's own `useSanitizer()` throws outside a provider (design.md
      // §5's stated fail-closed behaviour) -- Preact logs that as a render
      // error via console.error; suppressed here since the throw itself is
      // the assertion.
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

      expect(() =>
        render(<ReadingPane entry={{ ...baseEntry, summary: null, content: "Body" }} />),
      ).toThrow(/SanitizerContext/);

      consoleError.mockRestore();
    });
  });

  describe("mark-as-unread and star toggles (Amendment C)", () => {
    it("does not render toggle controls when no toggle handler is provided (backward compatible)", () => {
      renderReadingPane({
        entry: { ...baseEntry, summary: null, content: "Body", read: 1, starred: 0 },
      });

      expect(screen.queryByRole("button", { name: /mark as unread/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^(star|unstar)/i })).not.toBeInTheDocument();
    });

    it("shows an explicit 'Mark as unread' action for a read entry, wired to onToggleRead", () => {
      const onToggleRead = vi.fn();
      renderReadingPane({
        entry: { ...baseEntry, summary: null, content: "Body", read: 1, starred: 0 },
        onToggleRead,
      });

      fireEvent.click(screen.getByRole("button", { name: /mark as unread/i }));

      expect(onToggleRead).toHaveBeenCalledWith(baseEntry.id);
    });

    it("does not show 'Mark as unread' for an already-unread entry", () => {
      const onToggleRead = vi.fn();
      renderReadingPane({
        entry: { ...baseEntry, summary: null, content: "Body", read: 0, starred: 0 },
        onToggleRead,
      });

      expect(screen.queryByRole("button", { name: /mark as unread/i })).not.toBeInTheDocument();
    });

    it("shows a star/unstar toggle wired to onToggleStar, with an accessible state", () => {
      const onToggleStar = vi.fn();
      renderReadingPane({
        entry: { ...baseEntry, summary: null, content: "Body", read: 1, starred: 0 },
        onToggleStar,
      });

      const button = screen.getByRole("button", { name: "Star" });
      expect(button).toHaveAttribute("aria-pressed", "false");

      fireEvent.click(button);
      expect(onToggleStar).toHaveBeenCalledWith(baseEntry.id);
    });

    it("labels the star toggle 'Unstar' with aria-pressed true for an already-starred entry", () => {
      renderReadingPane({
        entry: { ...baseEntry, summary: null, content: "Body", read: 1, starred: 1 },
        onToggleStar: vi.fn(),
      });

      expect(screen.getByRole("button", { name: "Unstar" })).toHaveAttribute("aria-pressed", "true");
    });
  });
});
