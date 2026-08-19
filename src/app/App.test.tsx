import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { App } from "./App";
import type { AppEntry, AppFeed } from "./types";
import type { ClockPort } from "../ports/ClockPort";
import type { FeedSourcePort } from "../ports/FeedSourcePort";
import type { LocalStorePort } from "../ports/LocalStorePort";
import { createEntry, type Entry } from "../domain/models/Entry";
import { createFeed, type Feed } from "../domain/models/Feed";
import { ServicesProvider } from "./providers/ServicesContext";
import { SanitizerContext, type SanitizeFn } from "../ui/components/SafeHtml";

// `App` assumes a `SanitizerContext.Provider` ancestor -- `main.tsx` supplies
// the real one (design.md §5); these tests are not re-testing sanitization
// correctness (`SafeHtml.test.tsx` already does, with the real
// `DomPurifySanitizer` and its adversarial payload list), so an identity
// function is enough to prove `App`'s own wiring reaches `ReadingPane`.
const identitySanitize: SanitizeFn = (html) => html;

const feeds: AppFeed[] = [
  { id: "feed-1", title: "Hacker News", folder: null },
  { id: "feed-2", title: "Ars Technica", folder: "Tech" },
];

const entries: AppEntry[] = [
  {
    id: "entry-1",
    feedId: "feed-1",
    title: "IndexedDB in practice",
    publishedAt: "2026-08-18T09:00:00.000Z",
    read: 0,
    starred: 1,
    link: "https://example.com/1",
    summary: null,
    content: "Full article body.",
  },
  {
    id: "entry-2",
    feedId: "feed-2",
    title: "Service worker gotchas",
    publishedAt: "2026-08-17T09:00:00.000Z",
    read: 0,
    starred: 0,
    link: "https://example.com/2",
    summary: null,
    content: "Another article body.",
  },
];

const clock: ClockPort = { now: () => "2026-08-19T10:00:00.000Z" };
const feedSource: FeedSourcePort = { fetchFeed: vi.fn() };

/**
 * `App` now always renders through `EntryListContainer`/`ReadingPaneContainer`
 * (Slice 10a), which bind to real `toggleRead`/`toggleStar` via
 * `ServicesContext` regardless of whether `feeds`/`entries` were supplied as
 * a test override. Every test below therefore needs a `ServicesProvider`
 * ancestor -- this fake store is built from the SAME `feeds`/`entries`
 * fixtures the override props use, so a toggle click (routed through the
 * real service, not a mock of the service) behaves sanely against it.
 */
function toDomainFeed(feed: AppFeed): Feed {
  return createFeed({
    id: feed.id,
    url: `https://example.com/${feed.id}.xml`,
    normalizedUrl: `https://example.com/${feed.id}.xml`,
    title: feed.title,
    folder: feed.folder,
    addedAt: "2026-08-01T00:00:00.000Z",
  });
}

function toDomainEntry(entry: AppEntry): Entry {
  return {
    ...createEntry({
      id: entry.id,
      feedId: entry.feedId,
      contentHash: `hash-${entry.id}`,
      title: entry.title,
      link: entry.link,
      publishedAt: entry.publishedAt,
      fetchedAt: entry.publishedAt,
      summaryHtml: entry.summary,
      contentHtml: entry.content,
    }),
    read: entry.read,
    starred: entry.starred,
  };
}

function makeLocalStore(domainFeeds: Feed[], domainEntries: Entry[]): LocalStorePort {
  return {
    getFeed: vi.fn(async (id: string) => domainFeeds.find((feed) => feed.id === id)),
    listFeeds: vi.fn(async () => domainFeeds),
    listFeedsByFolder: vi.fn(),
    putFeed: vi.fn(),
    putFeedWithEntries: vi.fn(),
    deleteFeed: vi.fn(),
    getEntry: vi.fn(async (id: string) => domainEntries.find((entry) => entry.id === id)),
    getEntryByFeedAndGuid: vi.fn(),
    putEntry: vi.fn().mockResolvedValue(undefined),
    deleteEntry: vi.fn(),
    listEntriesByFeed: vi.fn(async (feedId: string) =>
      domainEntries.filter((entry) => entry.feedId === feedId),
    ),
    listEntriesByFeedPublished: vi.fn(async (feedId: string) =>
      domainEntries
        .filter((entry) => entry.feedId === feedId)
        .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)),
    ),
    listEntriesByPublished: vi.fn(),
    listUnreadEntries: vi.fn(),
    listStarredEntries: vi.fn(),
    getConfigValue: vi.fn(),
    putConfigValue: vi.fn(),
  } as unknown as LocalStorePort;
}

function renderApp(
  props: { feeds?: AppFeed[]; entries?: AppEntry[] } = {},
  localStore: LocalStorePort = makeLocalStore(feeds.map(toDomainFeed), entries.map(toDomainEntry)),
) {
  return render(
    <ServicesProvider services={{ localStore, clock, feedSource }}>
      <SanitizerContext.Provider value={identitySanitize}>
        <App {...props} />
      </SanitizerContext.Provider>
    </ServicesProvider>,
  );
}

function stubMatchMedia(matches: boolean) {
  // vi.stubGlobal (not a direct `window.matchMedia = ...` assignment) so the
  // afterEach's vi.unstubAllGlobals() actually reverts to setup.ts's default
  // stub between tests, instead of being a no-op that silently leaves the
  // previous test's mock in place.
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("App", () => {
  it("renders the feed sidebar, entry list, and reading pane landmarks", () => {
    stubMatchMedia(true);
    renderApp({ feeds, entries });

    expect(screen.getByRole("navigation", { name: "Feeds" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Entries" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Reading pane" })).toBeInTheDocument();
  });

  describe("responsive layout", () => {
    it("shows both the entry list and the reading pane at once on a wide viewport", () => {
      stubMatchMedia(true);
      renderApp({ feeds, entries });

      fireEvent.click(screen.getByRole("button", { name: /^indexeddb in practice/i }));

      expect(screen.getByRole("list", { name: "Entries" })).toBeInTheDocument();
      expect(screen.getByRole("region", { name: "Reading pane" })).toBeInTheDocument();
    });

    it("shows only one of the entry list or the reading pane at a time on a narrow viewport", () => {
      stubMatchMedia(false);
      renderApp({ feeds, entries });

      expect(screen.getByRole("list", { name: "Entries" })).toBeInTheDocument();
      expect(screen.queryByRole("region", { name: "Reading pane" })).not.toBeInTheDocument();
    });

    it("navigates to the reading pane on selection and back to the list via an explicit control", () => {
      stubMatchMedia(false);
      renderApp({ feeds, entries });

      fireEvent.click(screen.getByRole("button", { name: /^indexeddb in practice/i }));

      expect(screen.queryByRole("list", { name: "Entries" })).not.toBeInTheDocument();
      expect(screen.getByRole("region", { name: "Reading pane" })).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: /back/i }));

      expect(screen.getByRole("list", { name: "Entries" })).toBeInTheDocument();
      expect(screen.queryByRole("region", { name: "Reading pane" })).not.toBeInTheDocument();
    });

    it("moves focus to the reading pane heading after navigating to it on a narrow viewport", () => {
      stubMatchMedia(false);
      renderApp({ feeds, entries });

      fireEvent.click(screen.getByRole("button", { name: /^indexeddb in practice/i }));

      expect(document.activeElement).toBe(
        screen.getByRole("heading", { name: /indexeddb in practice/i }),
      );
    });

    it("returns focus to the previously selected entry after navigating back to the list on a narrow viewport", () => {
      stubMatchMedia(false);
      renderApp({ feeds, entries });

      fireEvent.click(screen.getByRole("button", { name: /^indexeddb in practice/i }));
      fireEvent.click(screen.getByRole("button", { name: /back/i }));

      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: /^indexeddb in practice/i }),
      );
    });
  });

  describe("selection", () => {
    it("selecting an entry marks it current in the list and renders it in the reading pane", () => {
      stubMatchMedia(true);
      renderApp({ feeds, entries });

      fireEvent.click(screen.getByRole("button", { name: /^indexeddb in practice/i }));

      expect(
        screen.getByRole("button", { name: /^indexeddb in practice/i }),
      ).toHaveAttribute("aria-current", "true");
      expect(
        screen.getByRole("heading", { name: /indexeddb in practice/i }),
      ).toBeInTheDocument();
    });

    it("switching feeds clears the previous entry selection", () => {
      stubMatchMedia(true);
      renderApp({ feeds, entries });

      fireEvent.click(screen.getByRole("button", { name: /^indexeddb in practice/i }));
      fireEvent.click(screen.getByRole("button", { name: /ars technica/i }));

      expect(screen.getByText(/select an entry/i)).toBeInTheDocument();
    });
  });

  describe("empty states (override props)", () => {
    it("shows an explicit empty state when there are no feeds", () => {
      stubMatchMedia(true);
      renderApp({ feeds: [], entries: [] }, makeLocalStore([], []));

      expect(screen.getByText(/no feeds yet/i)).toBeInTheDocument();
      expect(screen.getByText(/select an entry/i)).toBeInTheDocument();
    });

    it("shows an explicit empty state when the selected feed has no entries", () => {
      stubMatchMedia(true);
      renderApp({ feeds, entries: [] }, makeLocalStore(feeds.map(toDomainFeed), []));

      expect(screen.getByText(/this feed has no entries yet/i)).toBeInTheDocument();
    });
  });

  describe("loading real data via services, no override props (Slice 10a)", () => {
    it("loads feeds and entries from services.localStore, mounts EntryListContainer/ReadingPaneContainer, and routes a toggle click to putEntry", async () => {
      stubMatchMedia(true);
      const feed = toDomainFeed({ id: "feed-1", title: "Hacker News", folder: null });
      const entry = toDomainEntry({
        id: "entry-1",
        feedId: "feed-1",
        title: "IndexedDB in practice",
        publishedAt: "2026-08-18T09:00:00.000Z",
        read: 0,
        starred: 0,
        link: "https://example.com/1",
        summary: null,
        content: "Full article body.",
      });
      const localStore = makeLocalStore([feed], [entry]);

      render(
        <ServicesProvider services={{ localStore, clock, feedSource }}>
          <SanitizerContext.Provider value={identitySanitize}>
            <App />
          </SanitizerContext.Provider>
        </ServicesProvider>,
      );

      const toggleButton = await screen.findByRole("button", {
        name: /mark "indexeddb in practice" as read/i,
      });
      fireEvent.click(toggleButton);

      await waitFor(() => {
        expect(localStore.putEntry).toHaveBeenCalledWith(
          expect.objectContaining({ id: "entry-1", read: 1, readChangedAt: "2026-08-19T10:00:00.000Z" }),
        );
      });
    });

    it("renders sanitized HTML content in the reading pane, not escaped text (proves SafeHtml/SanitizerContext are wired end to end)", async () => {
      stubMatchMedia(true);
      const feed = toDomainFeed({ id: "feed-1", title: "Hacker News", folder: null });
      const entry = toDomainEntry({
        id: "entry-1",
        feedId: "feed-1",
        title: "IndexedDB in practice",
        publishedAt: "2026-08-18T09:00:00.000Z",
        read: 0,
        starred: 0,
        link: "https://example.com/1",
        summary: null,
        content: "<strong>bold</strong> claim",
      });
      const localStore = makeLocalStore([feed], [entry]);

      render(
        <ServicesProvider services={{ localStore, clock, feedSource }}>
          <SanitizerContext.Provider value={identitySanitize}>
            <App />
          </SanitizerContext.Provider>
        </ServicesProvider>,
      );

      await screen.findByRole("button", { name: /^indexeddb in practice/i });
      fireEvent.click(screen.getByRole("button", { name: /^indexeddb in practice/i }));

      const strong = await screen.findByText("bold");
      expect(strong.tagName).toBe("STRONG");
    });

    it("shows a distinct loading state before the store resolves, not an empty state", async () => {
      stubMatchMedia(true);
      let resolveFeeds: (feeds: Feed[]) => void = () => {};
      const localStore = makeLocalStore([], []);
      localStore.listFeeds = vi.fn(
        () =>
          new Promise<Feed[]>((resolve) => {
            resolveFeeds = resolve;
          }),
      );

      render(
        <ServicesProvider services={{ localStore, clock, feedSource }}>
          <SanitizerContext.Provider value={identitySanitize}>
            <App />
          </SanitizerContext.Provider>
        </ServicesProvider>,
      );

      expect(screen.getByText(/loading your feeds/i)).toBeInTheDocument();
      expect(screen.queryByText(/add a feed to see its entries/i)).not.toBeInTheDocument();

      resolveFeeds([]);
      await waitFor(() =>
        expect(screen.getByText(/add a feed to see its entries/i)).toBeInTheDocument(),
      );
    });

    it("shows a distinct, honest error state -- not a false empty state -- when the store read fails", async () => {
      stubMatchMedia(true);
      const localStore = makeLocalStore([], []);
      localStore.listFeeds = vi.fn().mockRejectedValue(new Error("IDB closed"));

      render(
        <ServicesProvider services={{ localStore, clock, feedSource }}>
          <SanitizerContext.Provider value={identitySanitize}>
            <App />
          </SanitizerContext.Provider>
        </ServicesProvider>,
      );

      await waitFor(() =>
        expect(screen.getByRole("alert")).toHaveTextContent(/could not load your feeds/i),
      );
      expect(screen.queryByText(/add a feed to see its entries/i)).not.toBeInTheDocument();
    });

    it("updates the sidebar's unread badge after marking an entry read (Finding 2, Slice 10a correction round)", async () => {
      stubMatchMedia(true);
      const feed = toDomainFeed({ id: "feed-1", title: "Hacker News", folder: null });
      let currentEntry = toDomainEntry({
        id: "entry-1",
        feedId: "feed-1",
        title: "IndexedDB in practice",
        publishedAt: "2026-08-18T09:00:00.000Z",
        read: 0,
        starred: 0,
        link: "https://example.com/1",
        summary: null,
        content: "Full article body.",
      });

      // A stateful fake, not the shared `makeLocalStore` helper: proving the
      // badge follows the store requires `putEntry` to actually mutate the
      // entry that `listEntriesByFeed`/`getEntry` subsequently return, the
      // same way the real `idbLocalStore` would.
      const localStore: LocalStorePort = {
        ...makeLocalStore([feed], []),
        getFeed: vi.fn(async () => feed),
        listFeeds: vi.fn(async () => [feed]),
        getEntry: vi.fn(async () => currentEntry),
        listEntriesByFeed: vi.fn(async (feedId: string) =>
          feedId === currentEntry.feedId ? [currentEntry] : [],
        ),
        listEntriesByFeedPublished: vi.fn(async (feedId: string) =>
          feedId === currentEntry.feedId ? [currentEntry] : [],
        ),
        putEntry: vi.fn(async (updated) => {
          currentEntry = updated;
        }),
      };

      render(
        <ServicesProvider services={{ localStore, clock, feedSource }}>
          <SanitizerContext.Provider value={identitySanitize}>
            <App />
          </SanitizerContext.Provider>
        </ServicesProvider>,
      );

      expect(
        await screen.findByRole("button", { name: /hacker news, 1 unread/i }),
      ).toBeInTheDocument();

      const toggleButton = await screen.findByRole("button", {
        name: /mark "indexeddb in practice" as read/i,
      });
      fireEvent.click(toggleButton);

      await waitFor(() => expect(localStore.putEntry).toHaveBeenCalled());
      await waitFor(() =>
        expect(screen.getByRole("button", { name: /hacker news, 0 unread/i })).toBeInTheDocument(),
      );
    });
  });
});
