import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/preact";
import type { ClockPort } from "../../ports/ClockPort";
import type { FeedParserPort } from "../../ports/FeedParserPort";
import type { FeedFetchResult, FeedSourcePort } from "../../ports/FeedSourcePort";
import type { LocalStorePort } from "../../ports/LocalStorePort";
import { createFeed, type Feed } from "../../domain/models/Feed";
import { ServicesProvider } from "../../app/providers/ServicesContext";
import { AddFeedContainer } from "./AddFeedContainer";

/**
 * Task 10.14: calls `subscribeToFeed` through `services.localStore`/
 * `services.feedSource`/`services.feedParser` -- test doubles for the PORTS,
 * never a mock of `subscribeToFeed` itself. Mocking the unit under test would
 * prove nothing about the wiring; these tests drive the real
 * `subscribeToFeed` (imported transitively through `AddFeedContainer`) via
 * its dependencies instead.
 */
const clock: ClockPort = { now: () => "2026-08-19T10:00:00.000Z" };

const FEED_URL = "https://example.com/feed.xml";

function makeLocalStore(overrides: Partial<LocalStorePort> = {}): LocalStorePort {
  return {
    getFeed: vi.fn().mockResolvedValue(undefined),
    listFeeds: vi.fn().mockResolvedValue([]),
    listFeedsByFolder: vi.fn(),
    putFeed: vi.fn(),
    putFeedWithEntries: vi.fn().mockResolvedValue(undefined),
    addFeedWithEntries: vi.fn().mockResolvedValue("created"),
    deleteFeed: vi.fn(),
    getEntry: vi.fn(),
    getEntryByFeedAndGuid: vi.fn(),
    putEntry: vi.fn(),
    deleteEntry: vi.fn(),
    listEntriesByFeed: vi.fn(),
    listEntriesByFeedPublished: vi.fn(),
    listEntriesByPublished: vi.fn(),
    listUnreadEntries: vi.fn(),
    listStarredEntries: vi.fn(),
    getConfigValue: vi.fn(),
    putConfigValue: vi.fn(),
    ...overrides,
  } as unknown as LocalStorePort;
}

function makeFeedSource(result: FeedFetchResult): FeedSourcePort {
  return { fetchFeed: vi.fn().mockResolvedValue(result) };
}

function submit(url: string) {
  fireEvent.input(screen.getByRole("textbox", { name: /feed url/i }), {
    target: { value: url },
  });
  fireEvent.click(screen.getByRole("button", { name: /add feed/i }));
}

function renderContainer(services: {
  localStore: LocalStorePort;
  feedSource: FeedSourcePort;
  feedParser: FeedParserPort;
  onSubscribed?: (feedId: string) => void;
}) {
  const { localStore, feedSource, feedParser, onSubscribed } = services;
  return render(
    <ServicesProvider services={{ localStore, clock, feedSource, feedParser }}>
      <AddFeedContainer onSubscribed={onSubscribed} />
    </ServicesProvider>,
  );
}

describe("AddFeedContainer", () => {
  it('maps status "subscribed" to AddFeedForm and calls onSubscribed with the new feed id', async () => {
    const localStore = makeLocalStore();
    const feedSource = makeFeedSource({
      status: "updated",
      body: "<rss/>",
      contentType: "application/rss+xml",
      etag: null,
      lastModified: null,
    });
    const feedParser: FeedParserPort = {
      parse: vi.fn().mockReturnValue({
        status: "parsed",
        feed: { title: "Example Blog", siteUrl: null, entries: [] },
      }),
    };
    const onSubscribed = vi.fn();

    renderContainer({ localStore, feedSource, feedParser, onSubscribed });
    submit(FEED_URL);

    expect(await screen.findByText(/added.*example blog/i)).toBeInTheDocument();
    expect(localStore.addFeedWithEntries).toHaveBeenCalled();
    await waitFor(() => expect(onSubscribed).toHaveBeenCalledWith(FEED_URL));
  });

  it('maps status "duplicate" to AddFeedForm and does not call onSubscribed', async () => {
    const existing: Feed = createFeed({
      id: FEED_URL,
      url: FEED_URL,
      normalizedUrl: FEED_URL,
      title: "Example Blog",
      addedAt: "2026-08-01T00:00:00.000Z",
    });
    const localStore = makeLocalStore({ getFeed: vi.fn().mockResolvedValue(existing) });
    const feedSource = makeFeedSource({
      status: "updated",
      body: "<rss/>",
      contentType: "application/rss+xml",
      etag: null,
      lastModified: null,
    });
    const feedParser: FeedParserPort = { parse: vi.fn() };
    const onSubscribed = vi.fn();

    renderContainer({ localStore, feedSource, feedParser, onSubscribed });
    submit(FEED_URL);

    expect(await screen.findByText(/already subscribed.*example blog/i)).toBeInTheDocument();
    expect(onSubscribed).not.toHaveBeenCalled();
  });

  it('maps status "invalid-url" to AddFeedForm without any network request', async () => {
    const localStore = makeLocalStore();
    const feedSource = makeFeedSource({
      status: "updated",
      body: "<rss/>",
      contentType: "application/rss+xml",
      etag: null,
      lastModified: null,
    });
    const feedParser: FeedParserPort = { parse: vi.fn() };

    renderContainer({ localStore, feedSource, feedParser });
    submit("not-a-url");

    expect(await screen.findByText(/absolute http/i)).toBeInTheDocument();
    expect(feedSource.fetchFeed).not.toHaveBeenCalled();
  });

  it('maps status "not-a-feed" to AddFeedForm, naming the submitted URL', async () => {
    const localStore = makeLocalStore();
    const feedSource = makeFeedSource({
      status: "updated",
      body: "<html></html>",
      contentType: "text/html",
      etag: null,
      lastModified: null,
    });
    const feedParser: FeedParserPort = {
      parse: vi.fn().mockReturnValue({
        status: "error",
        code: "PARSE_FAILED",
        message: "no recognizable feed format",
      }),
    };

    renderContainer({ localStore, feedSource, feedParser });
    submit(FEED_URL);

    const message = await screen.findByText(/no feed was found/i);
    expect(message.textContent).toContain(FEED_URL);
  });

  it('maps status "unreachable" to AddFeedForm, distinct from "not-a-feed"', async () => {
    const localStore = makeLocalStore();
    const feedSource = makeFeedSource({
      status: "error",
      code: "UPSTREAM_TIMEOUT",
      message: "the origin did not respond in time",
    });
    const feedParser: FeedParserPort = { parse: vi.fn() };

    renderContainer({ localStore, feedSource, feedParser });
    submit(FEED_URL);

    const message = await screen.findByText(/could not reach/i);
    expect(message.textContent).not.toMatch(/no feed was found/i);
  });

  it('maps status "persist-failed" to AddFeedForm when the atomic store write rejects', async () => {
    const localStore = makeLocalStore({
      addFeedWithEntries: vi.fn().mockRejectedValue(new Error("IndexedDB quota exceeded")),
    });
    const feedSource = makeFeedSource({
      status: "updated",
      body: "<rss/>",
      contentType: "application/rss+xml",
      etag: null,
      lastModified: null,
    });
    const feedParser: FeedParserPort = {
      parse: vi.fn().mockReturnValue({
        status: "parsed",
        feed: { title: "Example Blog", siteUrl: null, entries: [] },
      }),
    };
    const onSubscribed = vi.fn();

    renderContainer({ localStore, feedSource, feedParser, onSubscribed });
    submit(FEED_URL);

    expect(await screen.findByText(/could not be saved/i)).toBeInTheDocument();
    expect(onSubscribed).not.toHaveBeenCalled();
  });

  it("shows a submitting state while the request is in flight", async () => {
    let resolveFetch: (result: FeedFetchResult) => void = () => {};
    const feedSource: FeedSourcePort = {
      fetchFeed: vi.fn(
        () =>
          new Promise<FeedFetchResult>((resolve) => {
            resolveFetch = resolve;
          }),
      ),
    };
    const localStore = makeLocalStore();
    const feedParser: FeedParserPort = { parse: vi.fn() };

    renderContainer({ localStore, feedSource, feedParser });
    submit(FEED_URL);

    expect(await screen.findByRole("button", { name: /adding/i })).toBeInTheDocument();

    resolveFetch({ status: "error", code: "UPSTREAM_TIMEOUT", message: "timed out" });
    await waitFor(() => expect(screen.getByRole("button", { name: /add feed/i })).not.toBeDisabled());
  });
});
