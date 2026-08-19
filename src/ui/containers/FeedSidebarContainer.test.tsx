import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/preact";
import type { ClockPort } from "../../ports/ClockPort";
import type { FeedSourcePort } from "../../ports/FeedSourcePort";
import type { LocalStorePort } from "../../ports/LocalStorePort";
import { createEntry, type Entry } from "../../domain/models/Entry";
import { createFeed, type Feed } from "../../domain/models/Feed";
import { ServicesProvider } from "../../app/providers/ServicesContext";
import { FeedSidebarContainer } from "./FeedSidebarContainer";

const clock: ClockPort = { now: () => "2026-08-19T10:00:00.000Z" };
const feedSource: FeedSourcePort = { fetchFeed: vi.fn() };

function makeFeed(overrides: Partial<Feed> = {}): Feed {
  return {
    ...createFeed({
      id: "feed-1",
      url: "https://example.com/feed",
      normalizedUrl: "https://example.com/feed",
      title: "Hacker News",
      addedAt: "2026-08-19T00:00:00.000Z",
    }),
    ...overrides,
  };
}

function makeEntry(overrides: Partial<Entry> = {}): Entry {
  return {
    ...createEntry({
      id: "entry-1",
      feedId: "feed-1",
      contentHash: "hash",
      title: "T",
      link: "https://example.com/1",
      publishedAt: "2026-08-19T09:00:00.000Z",
      fetchedAt: "2026-08-19T09:00:00.000Z",
    }),
    ...overrides,
  };
}

function makeLocalStore(overrides: Partial<LocalStorePort> = {}): LocalStorePort {
  return {
    getFeed: vi.fn(),
    listFeeds: vi.fn().mockResolvedValue([]),
    listFeedsByFolder: vi.fn(),
    putFeed: vi.fn(),
    putFeedWithEntries: vi.fn(),
    deleteFeed: vi.fn(),
    getEntry: vi.fn(),
    getEntryByFeedAndGuid: vi.fn(),
    putEntry: vi.fn(),
    deleteEntry: vi.fn(),
    listEntriesByFeed: vi.fn().mockResolvedValue([]),
    listEntriesByFeedPublished: vi.fn(),
    listEntriesByPublished: vi.fn(),
    listUnreadEntries: vi.fn(),
    listStarredEntries: vi.fn(),
    getConfigValue: vi.fn(),
    putConfigValue: vi.fn(),
    ...overrides,
  } as unknown as LocalStorePort;
}

describe("FeedSidebarContainer", () => {
  it("loads feeds via listFeeds and computes each feed's unread count via listEntriesByFeed", async () => {
    const feed = makeFeed();
    const entries = [
      makeEntry({ id: "e1", read: 0 }),
      makeEntry({ id: "e2", read: 1 }),
      makeEntry({ id: "e3", read: 0 }),
    ];
    const localStore = makeLocalStore({
      listFeeds: vi.fn().mockResolvedValue([feed]),
      listEntriesByFeed: vi.fn().mockResolvedValue(entries),
    });

    render(
      <ServicesProvider services={{ localStore, clock, feedSource }}>
        <FeedSidebarContainer selectedFeedId={null} onSelectFeed={vi.fn()} />
      </ServicesProvider>,
    );

    expect(
      await screen.findByRole("button", { name: /hacker news.*2 unread/i }),
    ).toBeInTheDocument();
  });

  it("re-fetches feeds and unread counts when refreshSignal changes", async () => {
    const listFeeds = vi
      .fn()
      .mockResolvedValueOnce([makeFeed({ id: "feed-1", title: "Hacker News" })])
      .mockResolvedValueOnce([
        makeFeed({ id: "feed-1", title: "Hacker News" }),
        makeFeed({
          id: "feed-2",
          url: "https://example.com/feed2",
          normalizedUrl: "https://example.com/feed2",
          title: "Ars Technica",
        }),
      ]);
    const localStore = makeLocalStore({ listFeeds });

    const { rerender } = render(
      <ServicesProvider services={{ localStore, clock, feedSource }}>
        <FeedSidebarContainer selectedFeedId={null} onSelectFeed={vi.fn()} refreshSignal={0} />
      </ServicesProvider>,
    );

    await screen.findByRole("button", { name: /hacker news/i });
    expect(listFeeds).toHaveBeenCalledTimes(1);

    rerender(
      <ServicesProvider services={{ localStore, clock, feedSource }}>
        <FeedSidebarContainer selectedFeedId={null} onSelectFeed={vi.fn()} refreshSignal={1} />
      </ServicesProvider>,
    );

    await waitFor(() => expect(listFeeds).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("button", { name: /ars technica/i })).toBeInTheDocument();
  });

  it("shows a loading state before the store resolves, not an empty state", async () => {
    let resolveFeeds: (feeds: Feed[]) => void = () => {};
    const listFeeds = vi.fn(
      () =>
        new Promise<Feed[]>((resolve) => {
          resolveFeeds = resolve;
        }),
    );
    const localStore = makeLocalStore({ listFeeds });

    render(
      <ServicesProvider services={{ localStore, clock, feedSource }}>
        <FeedSidebarContainer selectedFeedId={null} onSelectFeed={vi.fn()} />
      </ServicesProvider>,
    );

    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    expect(screen.queryByText(/no feeds yet/i)).not.toBeInTheDocument();

    resolveFeeds([]);
    await waitFor(() => expect(screen.getByText(/no feeds yet/i)).toBeInTheDocument());
  });

  it("surfaces a distinct load-error message when the store read fails, instead of a false empty state", async () => {
    const localStore = makeLocalStore({
      listFeeds: vi.fn().mockRejectedValue(new Error("IDB closed")),
    });
    const onLoadError = vi.fn();

    render(
      <ServicesProvider services={{ localStore, clock, feedSource }}>
        <FeedSidebarContainer
          selectedFeedId={null}
          onSelectFeed={vi.fn()}
          onLoadError={onLoadError}
        />
      </ServicesProvider>,
    );

    await waitFor(() => expect(onLoadError).toHaveBeenCalledWith("IDB closed"));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText(/no feeds yet/i)).not.toBeInTheDocument();
  });
});
