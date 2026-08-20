import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/preact";
import type { ClockPort } from "../../ports/ClockPort";
import type { FeedParserPort } from "../../ports/FeedParserPort";
import type { FeedSourcePort } from "../../ports/FeedSourcePort";
import type { LocalStorePort } from "../../ports/LocalStorePort";
import { createEntry, type Entry } from "../../domain/models/Entry";
import { createFeed, type Feed } from "../../domain/models/Feed";
import { ServicesProvider } from "../../app/providers/ServicesContext";
import { FeedSidebarContainer } from "./FeedSidebarContainer";

const clock: ClockPort = { now: () => "2026-08-19T10:00:00.000Z" };
const feedSource: FeedSourcePort = { fetchFeed: vi.fn() };
const feedParser: FeedParserPort = { parse: vi.fn() };

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
      <ServicesProvider services={{ localStore, clock, feedSource, feedParser }}>
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
      <ServicesProvider services={{ localStore, clock, feedSource, feedParser }}>
        <FeedSidebarContainer
          selectedFeedId={null}
          onSelectFeed={vi.fn()}
          refreshSignal={[0, 0]}
        />
      </ServicesProvider>,
    );

    // `.*unread` scopes these to the SELECT button specifically -- every row
    // now also renders a "Remove <title>" button (task 10.18-10.19), which
    // would otherwise ambiguously match the same substring.
    await screen.findByRole("button", { name: /hacker news.*unread/i });
    expect(listFeeds).toHaveBeenCalledTimes(1);

    rerender(
      <ServicesProvider services={{ localStore, clock, feedSource, feedParser }}>
        <FeedSidebarContainer
          selectedFeedId={null}
          onSelectFeed={vi.fn()}
          refreshSignal={[1, 0]}
        />
      </ServicesProvider>,
    );

    await waitFor(() => expect(listFeeds).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("button", { name: /ars technica.*unread/i })).toBeInTheDocument();
  });

  it("re-fetches on a change to EITHER slot of the refreshSignal tuple, not just the first (Finding 4, Slice 10b correction round)", async () => {
    // `refreshSignal` is `[feedListVersion, entryStateVersion]` -- this
    // container must react to either changing on its own, since either one
    // (a feed added/removed, or an entry's read/unread state changing) is a
    // valid reason to re-fetch. Previously this was one summed number, so a
    // change to either counter always changed the sum too; the tuple form
    // must preserve that same "either slot changing re-fetches" behavior
    // explicitly, without relying on arithmetic.
    const listFeeds = vi.fn().mockResolvedValue([makeFeed({ id: "feed-1", title: "Hacker News" })]);
    const localStore = makeLocalStore({ listFeeds });
    // A SINGLE stable `services` object, reused across every render call
    // below -- matching production, where `services` comes from a context
    // value built once by `buildServices()` and never recreated for the
    // lifetime of the app. Constructing a fresh `services` literal on each
    // `rerender` call (as JSX naturally invites) would itself change
    // `FeedSidebarContainer`'s `useServices()` reference every time and
    // mask the exact thing this test isolates: whether `refreshSignal`'s
    // VALUES, not `services`, drive the re-fetch decision.
    const services = { localStore, clock, feedSource, feedParser };

    const { rerender } = render(
      <ServicesProvider services={services}>
        <FeedSidebarContainer
          selectedFeedId={null}
          onSelectFeed={vi.fn()}
          refreshSignal={[0, 0]}
        />
      </ServicesProvider>,
    );

    await screen.findByRole("button", { name: /hacker news.*unread/i });
    expect(listFeeds).toHaveBeenCalledTimes(1);

    // Only the SECOND slot changes here (entryStateVersion) -- the first
    // slot (feedListVersion) stays at 0.
    rerender(
      <ServicesProvider services={services}>
        <FeedSidebarContainer
          selectedFeedId={null}
          onSelectFeed={vi.fn()}
          refreshSignal={[0, 1]}
        />
      </ServicesProvider>,
    );

    await waitFor(() => expect(listFeeds).toHaveBeenCalledTimes(2));

    // A re-render handing down a NEW array with the SAME values must NOT
    // trigger a further re-fetch -- proves the effect depends on the two
    // destructured numbers, not on `refreshSignal`'s own array identity
    // (which would differ on every render, causing a needless re-fetch on
    // every unrelated App.tsx re-render in production).
    rerender(
      <ServicesProvider services={services}>
        <FeedSidebarContainer
          selectedFeedId={null}
          onSelectFeed={vi.fn()}
          refreshSignal={[0, 1]}
        />
      </ServicesProvider>,
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(listFeeds).toHaveBeenCalledTimes(2);
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
      <ServicesProvider services={{ localStore, clock, feedSource, feedParser }}>
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
      <ServicesProvider services={{ localStore, clock, feedSource, feedParser }}>
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

  /**
   * Task 10.18: `deleteFeed` (idbLocalStore, cascading entry deletion since
   * Slice 2) has been unreachable from the UI. Removal is destructive and
   * irreversible (feed-subscriptions spec, "Removal is confirmed before it
   * happens"), so the remove control MUST require an explicit confirmation
   * step before `services.localStore.deleteFeed` is ever called.
   */
  describe("remove feed (task 10.18-10.19)", () => {
    it("does not call deleteFeed on the first click -- it requires an explicit confirmation step", async () => {
      const feed = makeFeed();
      const localStore = makeLocalStore({ listFeeds: vi.fn().mockResolvedValue([feed]) });
      const onFeedRemoved = vi.fn();

      render(
        <ServicesProvider services={{ localStore, clock, feedSource, feedParser }}>
          <FeedSidebarContainer
            selectedFeedId={null}
            onSelectFeed={vi.fn()}
            onFeedRemoved={onFeedRemoved}
          />
        </ServicesProvider>,
      );

      fireEvent.click(await screen.findByRole("button", { name: /^remove hacker news$/i }));

      expect(localStore.deleteFeed).not.toHaveBeenCalled();
      expect(onFeedRemoved).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: /hacker news/i })).toBeInTheDocument();
    });

    it("states plainly what removal deletes -- the feed and its saved entries, including starred ones", async () => {
      const feed = makeFeed();
      const localStore = makeLocalStore({ listFeeds: vi.fn().mockResolvedValue([feed]) });

      render(
        <ServicesProvider services={{ localStore, clock, feedSource, feedParser }}>
          <FeedSidebarContainer selectedFeedId={null} onSelectFeed={vi.fn()} />
        </ServicesProvider>,
      );

      fireEvent.click(await screen.findByRole("button", { name: /^remove hacker news$/i }));

      expect(screen.getByText(/saved entries/i)).toBeInTheDocument();
      expect(screen.getByText(/starred/i)).toBeInTheDocument();
    });

    it("cancelling the confirmation never calls deleteFeed and leaves the feed in the list", async () => {
      const feed = makeFeed();
      const localStore = makeLocalStore({ listFeeds: vi.fn().mockResolvedValue([feed]) });

      render(
        <ServicesProvider services={{ localStore, clock, feedSource, feedParser }}>
          <FeedSidebarContainer selectedFeedId={null} onSelectFeed={vi.fn()} />
        </ServicesProvider>,
      );

      fireEvent.click(await screen.findByRole("button", { name: /^remove hacker news$/i }));
      fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

      expect(localStore.deleteFeed).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name: /hacker news.*unread/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^remove hacker news$/i })).toBeInTheDocument();
    });

    it("confirming removal calls deleteFeed, drops the feed from the rendered list, and calls onFeedRemoved", async () => {
      const feed = makeFeed();
      const localStore = makeLocalStore({
        listFeeds: vi.fn().mockResolvedValue([feed]),
        deleteFeed: vi.fn().mockResolvedValue(undefined),
      });
      const onFeedRemoved = vi.fn();

      render(
        <ServicesProvider services={{ localStore, clock, feedSource, feedParser }}>
          <FeedSidebarContainer
            selectedFeedId={null}
            onSelectFeed={vi.fn()}
            onFeedRemoved={onFeedRemoved}
          />
        </ServicesProvider>,
      );

      fireEvent.click(await screen.findByRole("button", { name: /^remove hacker news$/i }));
      fireEvent.click(screen.getByRole("button", { name: /^confirm removal$/i }));

      await waitFor(() => expect(localStore.deleteFeed).toHaveBeenCalledWith(feed.id));
      await waitFor(() =>
        expect(screen.queryByRole("button", { name: /hacker news/i })).not.toBeInTheDocument(),
      );
      expect(onFeedRemoved).toHaveBeenCalledWith(feed.id);
    });

    it("surfaces a distinct message when deleteFeed fails, without removing the feed from the list", async () => {
      const feed = makeFeed();
      const localStore = makeLocalStore({
        listFeeds: vi.fn().mockResolvedValue([feed]),
        deleteFeed: vi.fn().mockRejectedValue(new Error("IndexedDB transaction aborted")),
      });

      render(
        <ServicesProvider services={{ localStore, clock, feedSource, feedParser }}>
          <FeedSidebarContainer selectedFeedId={null} onSelectFeed={vi.fn()} />
        </ServicesProvider>,
      );

      fireEvent.click(await screen.findByRole("button", { name: /^remove hacker news$/i }));
      fireEvent.click(screen.getByRole("button", { name: /^confirm removal$/i }));

      expect(await screen.findByText(/indexeddb transaction aborted/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /hacker news.*unread/i })).toBeInTheDocument();
    });
  });
});
