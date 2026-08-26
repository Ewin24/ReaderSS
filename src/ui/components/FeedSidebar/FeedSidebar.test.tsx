import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/preact";
import { FeedSidebar, type FeedSidebarItem } from "./FeedSidebar";

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

function item(
  id: string,
  title: string,
  folder: string | null,
  unreadCount = 0,
): FeedSidebarItem {
  return { id, title, folder, unreadCount };
}

describe("FeedSidebar — collections", () => {
  const grouped = [
    item("a", "Loading Artist", "Comics"),
    item("b", "Aphyr", "News"),
    item("c", "Loose feed", null),
    item("d", "Poorly Drawn Lines", "Comics"),
  ];

  it("renders one labelled list per collection, ungrouped last", () => {
    render(<FeedSidebar feeds={grouped} selectedFeedId={null} onSelectFeed={vi.fn()} />);

    const lists = screen.getAllByRole("list");
    expect(lists).toHaveLength(3);
    expect(screen.getByRole("list", { name: "Comics" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "News" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "No collection" })).toBeInTheDocument();
  });

  it("orders named collections alphabetically and puts the ungrouped pile at the end", () => {
    render(<FeedSidebar feeds={grouped} selectedFeedId={null} onSelectFeed={vi.fn()} />);

    const headings = screen.getAllByRole("heading").map((node) => node.textContent);
    expect(headings[0]).toContain("Comics");
    expect(headings[1]).toContain("News");
    expect(headings[2]).toContain("No collection");
  });

  it("shows how many feeds each collection holds", () => {
    render(<FeedSidebar feeds={grouped} selectedFeedId={null} onSelectFeed={vi.fn()} />);

    expect(screen.getByRole("heading", { name: /comics/i }).textContent).toContain("2");
  });

  it("shows NO headings for a flat list, the common OPML shape", () => {
    // Labelling the whole sidebar "No collection" would announce a
    // distinction that does not exist yet.
    render(
      <FeedSidebar
        feeds={[item("a", "One", null), item("b", "Two", null)]}
        selectedFeedId={null}
        onSelectFeed={vi.fn()}
      />,
    );

    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(screen.getAllByRole("list")).toHaveLength(1);
  });

  it("still renders every feed exactly once when grouped", () => {
    render(<FeedSidebar feeds={grouped} selectedFeedId={null} onSelectFeed={vi.fn()} />);

    for (const feed of grouped) {
      expect(screen.getByRole("button", { name: new RegExp(`^${feed.title},`, "i") })).toBeInTheDocument();
    }
  });
});

describe("FeedSidebar — moving a feed into a collection", () => {
  const feeds = [
    item("a", "Loose feed", null),
    item("b", "Filed feed", "Comics"),
    item("c", "Other filed", "News"),
  ];

  function renderSidebar(onMoveFeed = vi.fn()) {
    render(
      <FeedSidebar
        feeds={feeds}
        selectedFeedId={null}
        onSelectFeed={vi.fn()}
        onMoveFeed={onMoveFeed}
      />,
    );
    return onMoveFeed;
  }

  function openMoveFor(title: string) {
    fireEvent.click(screen.getByRole("button", { name: `Move ${title} to a collection` }));
  }

  it("renders no move control at all when no handler is supplied", () => {
    render(<FeedSidebar feeds={feeds} selectedFeedId={null} onSelectFeed={vi.fn()} />);

    expect(screen.queryByRole("button", { name: /move .* to a collection/i })).not.toBeInTheDocument();
  });

  it("lists the collections that currently exist, plus none and new", () => {
    renderSidebar();
    openMoveFor("Loose feed");

    const options = screen.getAllByRole("option").map((node) => node.textContent);
    expect(options).toEqual(["No collection", "Comics", "News", "New collection…"]);
  });

  it("files an ungrouped feed into an existing collection", () => {
    const onMoveFeed = renderSidebar();
    openMoveFor("Loose feed");

    fireEvent.change(screen.getByLabelText(/collection for loose feed/i), {
      target: { value: "Comics" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onMoveFeed).toHaveBeenCalledWith("a", "Comics");
  });

  it("creates a new collection from a typed name", () => {
    const onMoveFeed = renderSidebar();
    openMoveFor("Loose feed");

    fireEvent.change(screen.getByLabelText(/collection for loose feed/i), {
      target: { value: "__new__" },
    });
    fireEvent.input(screen.getByLabelText(/new collection name/i), {
      target: { value: "  Reading  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    // Trimming is the service's job; the component passes what was typed.
    expect(onMoveFeed).toHaveBeenCalledWith("a", "  Reading  ");
  });

  it("refuses to save a new collection with a blank name", () => {
    const onMoveFeed = renderSidebar();
    openMoveFor("Loose feed");

    fireEvent.change(screen.getByLabelText(/collection for loose feed/i), {
      target: { value: "__new__" },
    });
    fireEvent.input(screen.getByLabelText(/new collection name/i), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    // Saving blank would silently mean "no collection", which is not what
    // someone who just chose "New collection" asked for.
    expect(onMoveFeed).not.toHaveBeenCalled();
  });

  it("takes a filed feed back out of its collection", () => {
    const onMoveFeed = renderSidebar();
    openMoveFor("Filed feed");

    fireEvent.change(screen.getByLabelText(/collection for filed feed/i), {
      target: { value: "__none__" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onMoveFeed).toHaveBeenCalledWith("b", null);
  });

  it("preselects the feed's current collection", () => {
    renderSidebar();
    openMoveFor("Filed feed");

    expect(screen.getByLabelText(/collection for filed feed/i)).toHaveValue("Comics");
  });

  it("emits nothing on cancel and closes the picker", () => {
    const onMoveFeed = renderSidebar();
    openMoveFor("Loose feed");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onMoveFeed).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(/collection for loose feed/i)).not.toBeInTheDocument();
  });

  it("closes the remove confirmation when the move picker opens", () => {
    // Two inline panels on one row at once would be a mess to read.
    render(
      <FeedSidebar
        feeds={feeds}
        selectedFeedId={null}
        onSelectFeed={vi.fn()}
        onMoveFeed={vi.fn()}
        onRemoveFeed={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove Loose feed" }));
    expect(screen.getByRole("button", { name: /confirm removal/i })).toBeInTheDocument();

    openMoveFor("Loose feed");

    expect(screen.queryByRole("button", { name: /confirm removal/i })).not.toBeInTheDocument();
  });
});

describe("FeedSidebar — collapsing collections", () => {
  const feeds = [
    item("a", "Loading Artist", "Comics", 3),
    item("b", "Poorly Drawn Lines", "Comics", 0),
    item("c", "Aphyr", "News", 0),
    item("d", "Loose feed", null, 0),
  ];

  function renderSidebar() {
    render(<FeedSidebar feeds={feeds} selectedFeedId={null} onSelectFeed={vi.fn()} />);
  }

  function toggleFor(name: RegExp) {
    return screen.getByRole("button", { name });
  }

  it("starts with every collection expanded", () => {
    renderSidebar();

    expect(toggleFor(/^comics,/i)).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("list", { name: "Comics" })).toBeInTheDocument();
  });

  it("hides a collection's feeds when collapsed, and brings them back", () => {
    renderSidebar();

    fireEvent.click(toggleFor(/^comics,/i));

    expect(toggleFor(/^comics,/i)).toHaveAttribute("aria-expanded", "false");
    // Out of the accessibility tree entirely, not merely off screen.
    expect(screen.queryByRole("list", { name: "Comics" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^loading artist,/i })).not.toBeInTheDocument();

    fireEvent.click(toggleFor(/^comics,/i));

    expect(screen.getByRole("list", { name: "Comics" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^loading artist,/i })).toBeInTheDocument();
  });

  it("collapses only the collection you clicked", () => {
    renderSidebar();

    fireEvent.click(toggleFor(/^comics,/i));

    expect(screen.getByRole("list", { name: "News" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "No collection" })).toBeInTheDocument();
  });

  it("can collapse the ungrouped pile too", () => {
    renderSidebar();

    fireEvent.click(toggleFor(/^no collection,/i));

    expect(screen.queryByRole("list", { name: "No collection" })).not.toBeInTheDocument();
  });

  it("keeps the heading, and both of its counts, visible while collapsed", () => {
    // The whole point of collapsing is to still know what is in there, and
    // where the new things are, without expanding each collection to look.
    renderSidebar();

    fireEvent.click(toggleFor(/^comics,/i));

    const heading = screen.getByRole("heading", { name: "Comics" });
    expect(heading).toBeInTheDocument();
    // Comics: 2 feeds, 3 unread.
    expect(heading.textContent).toContain("2");
    expect(heading.textContent).toContain("3");
  });

  it("shows both numbers even when a collection has nothing unread", () => {
    // A SINGLE number was the defect: it showed unread when there was any and
    // the feed count otherwise, so the same badge meant two different things
    // depending on data the reader cannot see. "1" next to News could be one
    // feed or one unread article, and nothing on screen said which.
    renderSidebar();

    // News: 1 feed, 0 unread. The zero is shown, not swapped for the feed
    // count.
    const heading = screen.getByRole("heading", { name: "News" });
    expect(heading.textContent).toContain("1");
    expect(heading.textContent).toContain("0");
  });

  it("labels the two numbers on hover, so the badge is not a riddle", () => {
    renderSidebar();

    expect(screen.getByRole("heading", { name: "Comics" }).querySelector("[title]")).toHaveAttribute(
      "title",
      "2 feeds, 3 unread",
    );
  });

  it("names each heading, so heading navigation can reach it", () => {
    // A heading whose children are all controls or aria-hidden computes an
    // EMPTY name, which makes it useless for jumping between collections.
    renderSidebar();

    expect(screen.getByRole("heading", { name: "Comics" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "News" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "No collection" })).toBeInTheDocument();
  });

  it("announces both counts to assistive technology, not just the visible one", () => {
    renderSidebar();

    expect(toggleFor(/^comics,/i)).toHaveAccessibleName("Comics, 2 feeds, 3 unread");
  });

  it("offers no collapse control for a flat list, which has no headings", () => {
    render(
      <FeedSidebar
        feeds={[item("a", "One", null), item("b", "Two", null)]}
        selectedFeedId={null}
        onSelectFeed={vi.fn()}
      />,
    );

    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    // Nothing can be hidden behind a control that does not exist.
    expect(screen.getByRole("list")).toBeInTheDocument();
  });

  it("keeps a newly appearing collection expanded", () => {
    // Collapsed names are tracked, not expanded ones, so a collection that
    // shows up later (imported, or created by filing a feed) starts open.
    const { rerender } = render(
      <FeedSidebar feeds={feeds} selectedFeedId={null} onSelectFeed={vi.fn()} />,
    );
    fireEvent.click(toggleFor(/^comics,/i));

    rerender(
      <FeedSidebar
        feeds={[...feeds, item("e", "New one", "Reading")]}
        selectedFeedId={null}
        onSelectFeed={vi.fn()}
      />,
    );

    expect(screen.getByRole("list", { name: "Reading" })).toBeInTheDocument();
    // ...and the one you collapsed stays collapsed.
    expect(screen.queryByRole("list", { name: "Comics" })).not.toBeInTheDocument();
  });
});
