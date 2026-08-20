import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/preact";
import { AddFeedForm, type AddFeedFormStatus } from "./AddFeedForm";

/**
 * Presentational only: a URL input, a submit callback, and a `status` prop.
 * The six `subscribeToFeed` outcomes MUST each
 * render a textually distinct, actionable message -- collapsing specific
 * failures into one shared fallback string is a real regression risk, so
 * `unreachable` and `not-a-feed` (two completely different problems for the
 * user) must read differently.
 */
describe("AddFeedForm", () => {
  it("renders a URL input and a submit button", () => {
    render(<AddFeedForm status={{ kind: "idle" }} onSubmit={vi.fn()} />);

    expect(screen.getByRole("textbox", { name: /feed url/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add feed/i })).toBeInTheDocument();
  });

  it("calls onSubmit with the entered URL when the form is submitted", () => {
    const onSubmit = vi.fn();
    render(<AddFeedForm status={{ kind: "idle" }} onSubmit={onSubmit} />);

    fireEvent.input(screen.getByRole("textbox", { name: /feed url/i }), {
      target: { value: "https://example.com/feed.xml" },
    });
    fireEvent.click(screen.getByRole("button", { name: /add feed/i }));

    expect(onSubmit).toHaveBeenCalledWith("https://example.com/feed.xml");
  });

  it("disables the input and submit button, and shows an in-progress label, while submitting", () => {
    render(<AddFeedForm status={{ kind: "submitting" }} onSubmit={vi.fn()} />);

    expect(screen.getByRole("textbox", { name: /feed url/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /adding/i })).toBeDisabled();
  });

  const STATUSES: { status: AddFeedFormStatus; mustContain: RegExp }[] = [
    { status: { kind: "subscribed", feedTitle: "Example Blog" }, mustContain: /added.*example blog/i },
    {
      status: { kind: "duplicate", feedTitle: "Example Blog" },
      mustContain: /already subscribed.*example blog/i,
    },
    { status: { kind: "invalid-url" }, mustContain: /absolute http/i },
    {
      status: { kind: "not-a-feed", message: "No feed was found at https://example.com/page. not a feed" },
      mustContain: /no feed was found/i,
    },
    {
      status: { kind: "unreachable", message: "Could not reach https://example.com/feed.xml. timed out" },
      mustContain: /could not reach/i,
    },
    {
      status: { kind: "persist-failed", message: "IndexedDB quota exceeded" },
      mustContain: /could not be saved/i,
    },
    {
      status: {
        kind: "relay-unavailable",
        message: "The app's feed relay did not respond -- this is a local setup problem.",
      },
      mustContain: /relay/i,
    },
    {
      status: {
        kind: "too-large",
        message: "response body exceeded the 5242880-byte limit",
      },
      mustContain: /too large/i,
    },
  ];

  it.each(STATUSES)("renders a status-specific message for status kind $status.kind", ({ status, mustContain }) => {
    render(<AddFeedForm status={status} onSubmit={vi.fn()} />);

    expect(screen.getByText(mustContain)).toBeInTheDocument();
  });

  it("renders eight textually distinct messages across the eight outcome statuses -- no shared generic fallback", () => {
    const feedTitle = "Example Blog";
    const messages = [
      { kind: "subscribed", feedTitle } as const,
      { kind: "duplicate", feedTitle } as const,
      { kind: "invalid-url" } as const,
      { kind: "not-a-feed", message: "No feed was found at https://example.com/page. not a feed" } as const,
      {
        kind: "unreachable",
        message: "Could not reach https://example.com/feed.xml. timed out",
      } as const,
      { kind: "persist-failed", message: "IndexedDB quota exceeded" } as const,
      {
        kind: "relay-unavailable",
        message: "The app's feed relay did not respond -- this is a local setup problem.",
      } as const,
      { kind: "too-large", message: "response body exceeded the 5242880-byte limit" } as const,
    ].map((status) => {
      const { unmount, container } = render(<AddFeedForm status={status} onSubmit={vi.fn()} />);
      const text = container.querySelector(".add-feed-form__message")?.textContent ?? "";
      unmount();
      return text;
    });

    expect(new Set(messages).size).toBe(messages.length);
  });

  it("shows an accessible alert for failure statuses, and a non-alert status message for success", () => {
    const { rerender } = render(<AddFeedForm status={{ kind: "invalid-url" }} onSubmit={vi.fn()} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();

    rerender(
      <AddFeedForm status={{ kind: "subscribed", feedTitle: "Example Blog" }} onSubmit={vi.fn()} />,
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("renders no status message at all when idle", () => {
    render(<AddFeedForm status={{ kind: "idle" }} onSubmit={vi.fn()} />);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
