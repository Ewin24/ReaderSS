import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, act } from "@testing-library/preact";
import { App } from "./App";
import type { AppEntry, AppFeed } from "./types";
import type { ClockPort } from "../ports/ClockPort";
import type { FeedParserPort } from "../ports/FeedParserPort";
import type { FeedSourcePort } from "../ports/FeedSourcePort";
import type { LocalStorePort } from "../ports/LocalStorePort";
import { createEntry, type Entry } from "../domain/models/Entry";
import { createFeed, type Feed } from "../domain/models/Feed";
import { ServicesProvider } from "./providers/ServicesContext";
import { SettingsProvider } from "./providers/SettingsProvider";
import { SanitizerContext, type SanitizeFn } from "../ui/components/SafeHtml";

// `App` assumes a `SanitizerContext.Provider` ancestor -- `main.tsx` supplies
// the real one; these tests are not re-testing sanitization
// correctness (`SafeHtml.test.tsx` already does, with the real
// `DomPurifySanitizer` and its malicious payload list), so an identity
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
const feedParser: FeedParserPort = { parse: vi.fn() };

/**
 * `App` now always renders through `EntryListContainer`/`ReadingPaneContainer`,
 * which bind to real `toggleRead`/`toggleStar` via
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
    addFeedWithEntries: vi.fn().mockResolvedValue("created"),
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
    <ServicesProvider services={{ localStore, clock, feedSource, feedParser }}>
      <SettingsProvider>
        <SanitizerContext.Provider value={identitySanitize}>
          <App {...props} />
        </SanitizerContext.Provider>
      </SettingsProvider>
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

  describe("loading real data via services, no override props", () => {
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
        <ServicesProvider services={{ localStore, clock, feedSource, feedParser }}>
          <SettingsProvider>
            <SanitizerContext.Provider value={identitySanitize}>
              <App />
            </SanitizerContext.Provider>
          </SettingsProvider>
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
        <ServicesProvider services={{ localStore, clock, feedSource, feedParser }}>
          <SettingsProvider>
            <SanitizerContext.Provider value={identitySanitize}>
              <App />
            </SanitizerContext.Provider>
          </SettingsProvider>
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
        <ServicesProvider services={{ localStore, clock, feedSource, feedParser }}>
          <SettingsProvider>
            <SanitizerContext.Provider value={identitySanitize}>
              <App />
            </SanitizerContext.Provider>
          </SettingsProvider>
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
        <ServicesProvider services={{ localStore, clock, feedSource, feedParser }}>
          <SettingsProvider>
            <SanitizerContext.Provider value={identitySanitize}>
              <App />
            </SanitizerContext.Provider>
          </SettingsProvider>
        </ServicesProvider>,
      );

      await waitFor(() =>
        expect(screen.getByRole("alert")).toHaveTextContent(/could not load your feeds/i),
      );
      expect(screen.queryByText(/add a feed to see its entries/i)).not.toBeInTheDocument();
    });

    it("updates the sidebar's unread badge after marking an entry read", async () => {
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
        <ServicesProvider services={{ localStore, clock, feedSource, feedParser }}>
          <SettingsProvider>
            <SanitizerContext.Provider value={identitySanitize}>
              <App />
            </SanitizerContext.Provider>
          </SettingsProvider>
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

    it("keeps an entry unread after an explicit 'mark as unread' click -- no silent auto-revert", async () => {
      stubMatchMedia(true);
      const feed = toDomainFeed({ id: "feed-1", title: "Hacker News", folder: null });
      // Starts READ, not unread: opening it must not itself write anything,
      // so the only `putEntry` call this test expects is the explicit
      // "Mark as unread" click below.
      let currentEntry = toDomainEntry({
        id: "entry-1",
        feedId: "feed-1",
        title: "IndexedDB in practice",
        publishedAt: "2026-08-18T09:00:00.000Z",
        read: 1,
        starred: 0,
        link: "https://example.com/1",
        summary: null,
        content: "Full article body.",
      });

      // A stateful, mutating fake -- same shape as the sidebar-badge test
      // above -- is REQUIRED to reproduce this bug: `App.tsx`'s
      // `handleEntryChanged` re-fetches the entry via `getEntry` after every
      // write and feeds the fresh object back into `ReadingPaneContainer`'s
      // `entry` prop, exactly as production does. A STATIC `entry` prop
      // (what `ReadingPaneContainer.test.tsx` alone uses) can never
      // reproduce this: the auto-mark effect's dependency on the live entry
      // never changes if the entry prop itself never changes.
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
        <ServicesProvider services={{ localStore, clock, feedSource, feedParser }}>
          <SettingsProvider>
            <SanitizerContext.Provider value={identitySanitize}>
              <App />
            </SanitizerContext.Provider>
          </SettingsProvider>
        </ServicesProvider>,
      );

      const entryButton = await screen.findByRole("button", { name: /^indexeddb in practice/i });
      fireEvent.click(entryButton);

      const markUnreadButton = await screen.findByRole("button", { name: /^mark as unread$/i });
      fireEvent.click(markUnreadButton);

      // Wait for the explicit write to settle AND for it to have genuinely
      // round-tripped back through App's live state -- the list item's own
      // accessible name reaching "...unread" proves the round trip
      // completed, not just that `putEntry` was called once.
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: /^indexeddb in practice,.*unread$/i }),
        ).toBeInTheDocument(),
      );

      // The bug this test exists to catch: the auto-mark-on-open effect,
      // watching the LIVE `entry` prop, sees the fresh `read: 0` value and
      // silently writes it straight back to `read: 1`. Give any such stray
      // effect/re-render several turns to run, then assert the SETTLED
      // state -- not merely that "unread" was reached at some point, which
      // a `waitFor` can catch on a transient flicker before a revert.
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(
        screen.getByRole("button", { name: /^indexeddb in practice,.*unread$/i }),
      ).toBeInTheDocument();
      expect(localStore.putEntry).toHaveBeenCalledTimes(1);
      expect(currentEntry.read).toBe(0);
    });
  });

  describe("settings panel", () => {
    it("shows the settings row with controls when the settings toggle is opened, and hides it when closed", () => {
      stubMatchMedia(true);
      renderApp({ feeds, entries });

      expect(screen.queryByRole("region", { name: /visual settings/i })).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: /^settings$/i }));
      expect(screen.getByRole("region", { name: /visual settings/i })).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: /^auto$/i })).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: /^close settings$/i }));
      expect(screen.queryByRole("region", { name: /visual settings/i })).not.toBeInTheDocument();
    });

    it("changing a control persists config/visual through the provider round-trip", async () => {
      stubMatchMedia(true);
      const localStore = makeLocalStore(feeds.map(toDomainFeed), entries.map(toDomainEntry));
      renderApp({ feeds, entries }, localStore);

      fireEvent.click(screen.getByRole("button", { name: /^settings$/i }));
      fireEvent.click(screen.getByRole("radio", { name: /^paginated$/i }));

      await waitFor(() =>
        expect(localStore.putConfigValue).toHaveBeenCalledWith(
          "visual",
          expect.objectContaining({ navMode: "paginated" }),
        ),
      );
    });
  });

  describe("pagination (navMode=paginated, client-side slicing over already-loaded entries)", () => {
    // Deterministically flush ALL pending Preact effects. A single
    // `act` + one microtask is not always enough: the settings-load render
    // queues a reset-on-navMode-change effect whose execution can otherwise
    // race with (and clobber) the test's scroll. Several event-loop turns
    // guarantee every queued effect has run and settled before we interact.
    async function flushEffects() {
      for (let i = 0; i < 5; i += 1) {
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 0));
        });
      }
    }

    function makeManyEntries(count: number, feedId = "feed-1"): AppEntry[] {
      return Array.from({ length: count }, (_, i) => ({
        id: `entry-${i + 1}`,
        feedId,
        title: `Article ${i + 1}`,
        publishedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
        read: 0,
        starred: 0,
        link: `https://example.com/${i + 1}`,
        summary: null,
        content: null,
      }));
    }

    function localStoreWithNavMode(navMode: "auto" | "paginated", many: AppEntry[]) {
      const store = makeLocalStore(feeds.map(toDomainFeed), many.map(toDomainEntry));
      store.getConfigValue = vi.fn(async <T,>(key: string): Promise<T | undefined> => {
        if (key === "visual") return { navMode } as T;
        return undefined;
      }) as LocalStorePort["getConfigValue"];
      return store;
    }

    it("shows only the first page slice when paginated", async () => {
      stubMatchMedia(true);
      const many = makeManyEntries(25);
      renderApp({ feeds, entries: many }, localStoreWithNavMode("paginated", many));

      expect(await screen.findByRole("button", { name: /^article 1, /i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^article 20, /i })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^article 21, /i })).not.toBeInTheDocument();
      expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
    });

    /**
     * Reaching the bottom of a page USED to jump to the next one. That was
     * removed as a defect, not simplified away: a page of 20 entries rarely
     * fits a viewport-height pane, so the scrollbar was almost always there,
     * and scrolling to read the rest of the page silently replaced it. Page
     * changes are explicit now.
     */
    it("does NOT change page when the list is scrolled to its end", async () => {
      stubMatchMedia(true);
      const many = makeManyEntries(25);
      const localStore = localStoreWithNavMode("paginated", many);
      renderApp({ feeds, entries: many }, localStore);

      const list = await screen.findByRole("list", { name: "Entries" });
      await screen.findByText("Page 1 of 2");
      await flushEffects();
      Object.defineProperty(list, "clientHeight", { value: 50, configurable: true });
      Object.defineProperty(list, "scrollHeight", { value: 100, configurable: true });
      list.scrollTop = 50;
      fireEvent.scroll(list);
      await flushEffects();

      expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^article 1, /i })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^article 21, /i })).not.toBeInTheDocument();
    });

    it("advances to the next slice of already-loaded entries via Next, with no new store query", async () => {
      stubMatchMedia(true);
      const many = makeManyEntries(25);
      const localStore = localStoreWithNavMode("paginated", many);
      renderApp({ feeds, entries: many }, localStore);

      await screen.findByText("Page 1 of 2");
      await flushEffects();
      fireEvent.click(screen.getByRole("button", { name: /next page/i }));

      expect(await screen.findByText("Page 2 of 2")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^article 21, /i })).toBeInTheDocument();
      // Slicing is client-side over already-loaded entries: no store query ran.
      expect(localStore.listEntriesByFeedPublished).not.toHaveBeenCalled();
    });

    it("resets to page 1 when the entries change", async () => {
      stubMatchMedia(true);
      const many = makeManyEntries(25);
      const first = renderApp({ feeds, entries: many }, localStoreWithNavMode("paginated", many));

      await screen.findByText("Page 1 of 2");
      await flushEffects();
      fireEvent.click(screen.getByRole("button", { name: /next page/i }));
      expect(await screen.findByText("Page 2 of 2")).toBeInTheDocument();
      first.unmount();

      // Re-render with a different (smaller) entry set → page resets to 1.
      // With only one page the footer is hidden entirely (single-page
      // behavior), which also confirms the page is no longer on page 2.
      const smaller = makeManyEntries(5);
      const localStore = localStoreWithNavMode("paginated", smaller);
      renderApp({ feeds, entries: smaller }, localStore);

      expect(await screen.findByRole("list", { name: "Entries" })).toBeInTheDocument();
      expect(screen.queryByText(/page \d+ of \d+/i)).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /next page/i })).not.toBeInTheDocument();
    });

    it("shows the full list with no slicing when navMode is auto", async () => {
      stubMatchMedia(true);
      const many = makeManyEntries(25);
      renderApp({ feeds, entries: many }, localStoreWithNavMode("auto", many));

      expect(await screen.findByRole("button", { name: /^article 1, /i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /^article 25, /i })).toBeInTheDocument();
      expect(screen.queryByText(/page \d+ of \d+/i)).not.toBeInTheDocument();
    });
  });

  describe("content pagination (navMode=paginated, the reading pane's body split into pages)", () => {
    function localStoreWithNavMode(navMode: "auto" | "paginated", many: AppEntry[]) {
      const store = makeLocalStore(feeds.map(toDomainFeed), many.map(toDomainEntry));
      store.getConfigValue = vi.fn(async <T,>(key: string): Promise<T | undefined> => {
        if (key === "visual") return { navMode } as T;
        return undefined;
      }) as LocalStorePort["getConfigValue"];
      return store;
    }

    function makeLongEntry(): AppEntry {
      return {
        id: "entry-long",
        feedId: "feed-1",
        title: "A long article",
        publishedAt: "2026-08-18T09:00:00.000Z",
        read: 0,
        starred: 0,
        link: "https://example.com/long",
        summary: null,
        content:
          "<h1>Title</h1><p>P1</p><p>P2</p><p>P3</p><p>P4</p><p>P5</p><p>P6</p><p>P7</p><p>P8</p><p>P9</p><p>P10</p>",
      };
    }

    it("splits the selected entry's body into pages and renders only page 1 with a footer", async () => {
      stubMatchMedia(true);
      const many = [makeLongEntry()];
      renderApp({ feeds, entries: many }, localStoreWithNavMode("paginated", many));

      fireEvent.click(screen.getByRole("button", { name: /^a long article/i }));

      // Page 1 shows the first page's blocks; the footer reveals the total.
      // Wait for the footer first: it renders in the same commit as the
      // paginated page-1 body, so it is the deterministic signal that the
      // (asynchronously loaded) paginated mode is active before we assert on
      // the page content.
      expect(await screen.findByText(/page 1 of \d+/i)).toBeInTheDocument();
      expect(screen.getByText("P1")).toBeInTheDocument();
      // A block beyond the first page is not rendered.
      expect(screen.queryByText("P10")).not.toBeInTheDocument();
    });

    it("advances to the next content page when Next is clicked", async () => {
      stubMatchMedia(true);
      const many = [makeLongEntry()];
      renderApp({ feeds, entries: many }, localStoreWithNavMode("paginated", many));

      fireEvent.click(screen.getByRole("button", { name: /^a long article/i }));
      await screen.findByText(/page 1 of \d+/i);

      fireEvent.click(screen.getByRole("button", { name: /next page/i }));

      expect(await screen.findByText(/page 2 of \d+/i)).toBeInTheDocument();
    });

    it("resets the content page to 1 when a different entry is opened", async () => {
      stubMatchMedia(true);
      const long = makeLongEntry();
      const short = {
        ...long,
        id: "entry-short",
        title: "A short article",
        link: "https://example.com/short",
        content: "<p>Only one block.</p>",
      };
      const many = [long, short];
      renderApp({ feeds, entries: many }, localStoreWithNavMode("paginated", many));

      fireEvent.click(screen.getByRole("button", { name: /^a long article/i }));
      await screen.findByText(/page 1 of \d+/i);
      fireEvent.click(screen.getByRole("button", { name: /next page/i }));
      await screen.findByText(/page 2 of \d+/i);

      fireEvent.click(screen.getByRole("button", { name: /^a short article/i }));

      // The short entry has a single page → no footer (page effectively reset).
      expect(await screen.findByText("Only one block.")).toBeInTheDocument();
      expect(screen.queryByText(/page \d+ of \d+/i)).not.toBeInTheDocument();
    });

    it("does not paginate the pane content when navMode is auto", async () => {
      stubMatchMedia(true);
      const many = [makeLongEntry()];
      renderApp({ feeds, entries: many }, localStoreWithNavMode("auto", many));

      fireEvent.click(screen.getByRole("button", { name: /^a long article/i }));

      // Whole body rendered, no content-pagination footer.
      expect(await screen.findByText("P10")).toBeInTheDocument();
      expect(screen.queryByText(/page \d+ of \d+/i)).not.toBeInTheDocument();
    });
  });

  /**
   * `AddFeedContainer` and `RefreshContainer` mounted
   * inside `App.tsx`. Uses a stateful fake `LocalStorePort` (mutated by
   * `putFeedWithEntries`/`putEntry`/`deleteFeed`, the same way the real
   * `idbLocalStore` would be) rather than the shared static-array
   * `makeLocalStore` helper, since these flows genuinely change which feeds
   * and entries exist.
   */
  describe("add-feed, refresh, and remove-feed mounted in App", () => {
    function makeStatefulLocalStore(): LocalStorePort {
      let feedsState: Feed[] = [];
      let entriesState: Entry[] = [];
      return {
        getFeed: vi.fn(async (id: string) => feedsState.find((f) => f.id === id)),
        listFeeds: vi.fn(async () => feedsState),
        listFeedsByFolder: vi.fn(),
        putFeed: vi.fn(async (feed: Feed) => {
          feedsState = [...feedsState.filter((f) => f.id !== feed.id), feed];
        }),
        putFeedWithEntries: vi.fn(async (feed: Feed, entries: readonly Entry[]) => {
          feedsState = [...feedsState.filter((f) => f.id !== feed.id), feed];
          entriesState = [...entriesState, ...entries];
        }),
        addFeedWithEntries: vi.fn(async (feed: Feed, entries: readonly Entry[]) => {
          if (feedsState.some((f) => f.id === feed.id)) {
            return "duplicate" as const;
          }
          feedsState = [...feedsState, feed];
          entriesState = [...entriesState, ...entries];
          return "created" as const;
        }),
        deleteFeed: vi.fn(async (id: string) => {
          feedsState = feedsState.filter((f) => f.id !== id);
          entriesState = entriesState.filter((e) => e.feedId !== id);
        }),
        getEntry: vi.fn(async (id: string) => entriesState.find((e) => e.id === id)),
        getEntryByFeedAndGuid: vi.fn(),
        putEntry: vi.fn(async (entry: Entry) => {
          entriesState = entriesState.map((e) => (e.id === entry.id ? entry : e));
        }),
        deleteEntry: vi.fn(),
        listEntriesByFeed: vi.fn(async (feedId: string) =>
          entriesState.filter((e) => e.feedId === feedId),
        ),
        listEntriesByFeedPublished: vi.fn(async (feedId: string) =>
          entriesState
            .filter((e) => e.feedId === feedId)
            .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)),
        ),
        listEntriesByPublished: vi.fn(),
        listUnreadEntries: vi.fn(),
        listStarredEntries: vi.fn(),
        getConfigValue: vi.fn(),
        putConfigValue: vi.fn(),
      } as unknown as LocalStorePort;
    }

    it("adding a feed selects it and shows its entries, without a page reload", async () => {
      stubMatchMedia(true);
      const localStore = makeStatefulLocalStore();
      const newFeedUrl = "https://example.com/new-feed.xml";
      const feedSourceStub: FeedSourcePort = {
        fetchFeed: vi.fn().mockResolvedValue({
          status: "updated",
          body: "<rss/>",
          contentType: "application/rss+xml",
          etag: null,
          lastModified: null,
        }),
      };
      const feedParserStub: FeedParserPort = {
        parse: vi.fn().mockReturnValue({
          status: "parsed",
          feed: {
            title: "New Feed",
            siteUrl: null,
            entries: [
              createEntry({
                id: `${newFeedUrl}:1`,
                feedId: newFeedUrl,
                contentHash: "hash-1",
                title: "First post",
                link: "https://example.com/first-post",
                publishedAt: "2026-08-19T09:00:00.000Z",
                fetchedAt: "2026-08-19T09:00:00.000Z",
              }),
            ],
          },
        }),
      };

      render(
        <ServicesProvider
          services={{ localStore, clock, feedSource: feedSourceStub, feedParser: feedParserStub }}
        >
          <SettingsProvider>
            <SanitizerContext.Provider value={identitySanitize}>
              <App />
            </SanitizerContext.Provider>
          </SettingsProvider>
        </ServicesProvider>,
      );

      await screen.findByText(/no feeds yet/i);
      fireEvent.input(screen.getByRole("textbox", { name: /feed url/i }), {
        target: { value: newFeedUrl },
      });
      fireEvent.click(screen.getByRole("button", { name: /^add feed$/i }));

      expect(await screen.findByText(/added.*new feed/i)).toBeInTheDocument();
      // Anchored exactly to the sidebar's own accessible-name format
      // (`"${title}, ${count} unread"`) -- a looser `/new feed.*unread/i`
      // also matches the entry row's accessible name ("First post, New
      // Feed, published ..., unread"), which is ambiguous once the entry
      // itself renders.
      await waitFor(() =>
        expect(screen.getByRole("button", { name: /^new feed, \d+ unread$/i })).toHaveAttribute(
          "aria-current",
          "true",
        ),
      );
      expect(await screen.findByRole("button", { name: /^first post/i })).toBeInTheDocument();
    });

    it("refreshing reloads the selected feed's entries and the sidebar's unread count", async () => {
      stubMatchMedia(true);
      const localStore = makeStatefulLocalStore();
      const feed = toDomainFeed({ id: "feed-1", title: "Hacker News", folder: null });
      await localStore.putFeed(feed);
      const feedSourceStub: FeedSourcePort = {
        fetchFeed: vi.fn().mockResolvedValue({
          status: "updated",
          body: "<rss/>",
          contentType: "application/rss+xml",
          etag: null,
          lastModified: null,
        }),
      };
      const feedParserStub: FeedParserPort = {
        parse: vi.fn().mockReturnValue({
          status: "parsed",
          feed: {
            title: "Hacker News",
            siteUrl: null,
            entries: [
              createEntry({
                id: "feed-1:1",
                feedId: "feed-1",
                contentHash: "hash-1",
                title: "Freshly refreshed post",
                link: "https://example.com/refreshed",
                publishedAt: "2026-08-19T09:00:00.000Z",
                fetchedAt: "2026-08-19T09:00:00.000Z",
              }),
            ],
          },
        }),
      };

      render(
        <ServicesProvider
          services={{ localStore, clock, feedSource: feedSourceStub, feedParser: feedParserStub }}
        >
          <SettingsProvider>
            <SanitizerContext.Provider value={identitySanitize}>
              <App />
            </SanitizerContext.Provider>
          </SettingsProvider>
        </ServicesProvider>,
      );

      await screen.findByRole("button", { name: /hacker news.*unread/i });
      fireEvent.click(screen.getByRole("button", { name: /^refresh$/i }));

      expect(await screen.findByRole("button", { name: /^freshly refreshed post/i })).toBeInTheDocument();
    });

    it("removing the selected feed clears the selection and its entry list", async () => {
      stubMatchMedia(true);
      const localStore = makeStatefulLocalStore();
      const feed = toDomainFeed({ id: "feed-1", title: "Hacker News", folder: null });
      await localStore.putFeed(feed);
      const feedSourceStub: FeedSourcePort = { fetchFeed: vi.fn() };
      const feedParserStub: FeedParserPort = { parse: vi.fn() };

      render(
        <ServicesProvider
          services={{ localStore, clock, feedSource: feedSourceStub, feedParser: feedParserStub }}
        >
          <SettingsProvider>
            <SanitizerContext.Provider value={identitySanitize}>
              <App />
            </SanitizerContext.Provider>
          </SettingsProvider>
        </ServicesProvider>,
      );

      await screen.findByRole("button", { name: /hacker news.*unread/i });
      // Wait for the feed to genuinely be the SELECTED feed (its entry list
      // has settled) before removing it -- otherwise this assertion could
      // pass by coincidence, catching App's default-selection effect still
      // mid-flight rather than proving removal actually cleared it.
      await screen.findByText(/this feed has no entries yet/i);

      fireEvent.click(screen.getByRole("button", { name: /^remove hacker news$/i }));
      fireEvent.click(screen.getByRole("button", { name: /^confirm removal$/i }));

      await waitFor(() =>
        expect(screen.queryByRole("button", { name: /hacker news/i })).not.toBeInTheDocument(),
      );
      expect(await screen.findByText(/add a feed to see its entries/i)).toBeInTheDocument();
    });
  });
});

/**
 * Page memory. Moving to another feed and back, or to another entry and
 * back, returns to the page you left rather than to page 1.
 *
 * Scope, asserted deliberately: memory is keyed to the exact list/document it
 * was taken from. When the underlying entries change (a refresh, a prune) the
 * remembered list position is DROPPED, because a page number only means
 * something against the list it was measured on. Nothing is persisted across
 * a reload for the same reason.
 */
describe("App — remembered pagination position", () => {
  async function flush() {
    for (let i = 0; i < 5; i += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  }

  function paginatedStore(all: AppEntry[]) {
    const store = makeLocalStore(feeds.map(toDomainFeed), all.map(toDomainEntry));
    store.getConfigValue = vi.fn(async <T,>(key: string): Promise<T | undefined> => {
      if (key === "visual") return { navMode: "paginated" } as T;
      return undefined;
    }) as LocalStorePort["getConfigValue"];
    return store;
  }

  function entriesFor(feedId: string, count: number, prefix: string): AppEntry[] {
    return Array.from({ length: count }, (_, i) => ({
      id: `${prefix}-${i + 1}`,
      feedId,
      title: `${prefix} ${i + 1}`,
      publishedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
      read: 0 as const,
      starred: 0 as const,
      link: `https://example.com/${prefix}/${i + 1}`,
      summary: null,
      content: null,
    }));
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns to the page you left when you switch feeds and come back", async () => {
    stubMatchMedia(true);
    const all = [...entriesFor("feed-1", 25, "Alpha"), ...entriesFor("feed-2", 25, "Beta")];
    renderApp({ feeds, entries: all }, paginatedStore(all));

    // Feed 1 -> page 2.
    fireEvent.click(screen.getByRole("button", { name: /^Hacker News,/i }));
    await screen.findByText("Page 1 of 2");
    await flush();
    fireEvent.click(screen.getByRole("button", { name: /next page/i }));
    expect(await screen.findByText("Page 2 of 2")).toBeInTheDocument();

    // Away to feed 2: its own position starts at page 1.
    fireEvent.click(screen.getByRole("button", { name: /^Ars Technica,/i }));
    await flush();
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();

    // Back to feed 1: page 2 again, not page 1.
    fireEvent.click(screen.getByRole("button", { name: /^Hacker News,/i }));
    await flush();
    expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Alpha 21,/i })).toBeInTheDocument();
  });

  it("returns to the content page you left when you reopen the same entry", async () => {
    stubMatchMedia(true);
    const long: AppEntry = {
      id: "entry-long",
      feedId: "feed-1",
      title: "A long article",
      publishedAt: "2026-08-18T09:00:00.000Z",
      read: 0,
      starred: 0,
      link: "https://example.com/long",
      summary: null,
      content: Array.from({ length: 14 }, (_, i) => `<p>P${i + 1}</p>`).join(""),
    };
    const other: AppEntry = {
      ...long,
      id: "entry-other",
      title: "Another article",
      link: "https://example.com/other",
      content: "<p>Only one</p>",
    };
    const all = [long, other];
    renderApp({ feeds, entries: all }, paginatedStore(all));

    fireEvent.click(screen.getByRole("button", { name: /^a long article/i }));
    await screen.findByText(/page 1 of \d+/i);
    fireEvent.click(screen.getByRole("button", { name: /next page/i }));
    expect(await screen.findByText(/page 2 of \d+/i)).toBeInTheDocument();

    // Open a different entry, then come back to the first one.
    fireEvent.click(screen.getByRole("button", { name: /^another article/i }));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: /^a long article/i }));
    await flush();

    expect(screen.getByText(/page 2 of \d+/i)).toBeInTheDocument();
  });

  it("drops the remembered list page when the underlying entries change", async () => {
    stubMatchMedia(true);
    const all = entriesFor("feed-1", 25, "Alpha");
    const first = renderApp({ feeds, entries: all }, paginatedStore(all));

    fireEvent.click(screen.getByRole("button", { name: /^Hacker News,/i }));
    await screen.findByText("Page 1 of 2");
    await flush();
    fireEvent.click(screen.getByRole("button", { name: /next page/i }));
    expect(await screen.findByText("Page 2 of 2")).toBeInTheDocument();
    first.unmount();

    const fewer = entriesFor("feed-1", 5, "Alpha");
    renderApp({ feeds, entries: fewer }, paginatedStore(fewer));
    await flush();

    // One page only: the footer is hidden entirely, which is also proof the
    // stale "page 2" was not restored.
    expect(screen.queryByText(/page \d+ of \d+/i)).not.toBeInTheDocument();
  });
});
