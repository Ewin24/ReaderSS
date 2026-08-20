import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/preact";
import { FeedSidebar } from "./FeedSidebar";

const feeds = [
  { id: "feed-1", title: "Hacker News", folder: null, unreadCount: 0 },
  { id: "feed-2", title: "Ars Technica", folder: "Tech", unreadCount: 0 },
];

describe("FeedSidebar", () => {
  it("renders one entry per feed as a real button, inside a navigation landmark", () => {
    render(
      <FeedSidebar feeds={feeds} selectedFeedId={null} onSelectFeed={vi.fn()} />,
    );

    const nav = screen.getByRole("navigation", { name: "Feeds" });
    expect(nav).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /hacker news/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /ars technica/i }),
    ).toBeInTheDocument();
  });

  it("marks the selected feed as current for assistive technology", () => {
    render(
      <FeedSidebar feeds={feeds} selectedFeedId="feed-2" onSelectFeed={vi.fn()} />,
    );

    expect(
      screen.getByRole("button", { name: /ars technica/i }),
    ).toHaveAttribute("aria-current", "true");
    expect(
      screen.getByRole("button", { name: /hacker news/i }),
    ).not.toHaveAttribute("aria-current");
  });

  it("calls onSelectFeed with the feed id when a feed button is activated", () => {
    const onSelectFeed = vi.fn();
    render(
      <FeedSidebar feeds={feeds} selectedFeedId={null} onSelectFeed={onSelectFeed} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /hacker news/i }));

    expect(onSelectFeed).toHaveBeenCalledWith("feed-1");
  });

  it("shows an explicit empty state explaining the next action when there are no feeds", () => {
    render(<FeedSidebar feeds={[]} selectedFeedId={null} onSelectFeed={vi.fn()} />);

    expect(screen.getByRole("navigation", { name: "Feeds" })).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText(/no feeds yet/i)).toBeInTheDocument();
  });

  describe("unread counts", () => {
    it("displays each feed's unread count", () => {
      render(
        <FeedSidebar
          feeds={[
            { id: "feed-1", title: "Hacker News", folder: null, unreadCount: 3 },
            { id: "feed-2", title: "Ars Technica", folder: "Tech", unreadCount: 0 },
          ]}
          selectedFeedId={null}
          onSelectFeed={vi.fn()}
        />,
      );

      expect(
        screen.getByRole("button", { name: /hacker news.*3 unread/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /ars technica.*0 unread/i }),
      ).toBeInTheDocument();
    });
  });
});
