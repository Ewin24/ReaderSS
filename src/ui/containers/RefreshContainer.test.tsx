import { opmlCodecStub } from "../../test/doubles/opmlCodecStub";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/preact";
import type { ClockPort } from "../../ports/ClockPort";
import type { FeedParserPort } from "../../ports/FeedParserPort";
import type { FeedFetchResult, FeedSourcePort } from "../../ports/FeedSourcePort";
import type { LocalStorePort } from "../../ports/LocalStorePort";
import { createFeed, type Feed } from "../../domain/models/Feed";
import { ServicesProvider } from "../../app/providers/ServicesContext";
import { RefreshContainer } from "./RefreshContainer";

/**
 * A refresh control invokes the real `refreshFeeds` (never mocked); per-feed
 * `lastError` entries render through the existing `RefreshErrorChip` -- ONE
 * chip per failed feed, never one aggregated message, so per-feed errors are
 * isolated even on a partial refresh failure.
 */
const clock: ClockPort = { now: () => "2026-08-19T10:00:00.000Z" };

function makeFeed(overrides: Partial<Feed> & { id: string; title: string }): Feed {
  return {
    ...createFeed({
      id: overrides.id,
      url: overrides.id,
      normalizedUrl: overrides.id,
      title: overrides.title,
      addedAt: "2026-08-01T00:00:00.000Z",
    }),
    ...overrides,
  };
}

function makeLocalStore(overrides: Partial<LocalStorePort> = {}): LocalStorePort {
  return {
    getFeed: vi.fn(),
    listFeeds: vi.fn().mockResolvedValue([]),
    listFeedsByFolder: vi.fn(),
    putFeed: vi.fn().mockResolvedValue(undefined),
    putFeedWithEntries: vi.fn().mockResolvedValue(undefined),
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

const feedParser: FeedParserPort = { parse: vi.fn() };

function renderContainer(
  localStore: LocalStorePort,
  feedSource: FeedSourcePort,
  onRefreshed?: () => void,
) {
  return render(
    <ServicesProvider services={{ localStore, clock, feedSource, feedParser, opmlCodec: opmlCodecStub }}>
      <RefreshContainer onRefreshed={onRefreshed} />
    </ServicesProvider>,
  );
}

describe("RefreshContainer", () => {
  it("invokes refreshFeeds and renders no chips when every feed succeeds", async () => {
    const feedA = makeFeed({ id: "https://a.example/feed", title: "Feed A" });
    const localStore = makeLocalStore({ listFeeds: vi.fn().mockResolvedValue([feedA]) });
    const feedSource: FeedSourcePort = {
      fetchFeed: vi.fn().mockResolvedValue({ status: "not-modified" } satisfies FeedFetchResult),
    };
    const onRefreshed = vi.fn();

    renderContainer(localStore, feedSource, onRefreshed);
    fireEvent.click(screen.getByRole("button", { name: /^refresh$/i }));

    await waitFor(() => expect(onRefreshed).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("indicates in-progress state until every feed has settled", async () => {
    let resolveFetch: (result: FeedFetchResult) => void = () => {};
    const feedA = makeFeed({ id: "https://a.example/feed", title: "Feed A" });
    const localStore = makeLocalStore({ listFeeds: vi.fn().mockResolvedValue([feedA]) });
    const feedSource: FeedSourcePort = {
      fetchFeed: vi.fn(
        () =>
          new Promise<FeedFetchResult>((resolve) => {
            resolveFetch = resolve;
          }),
      ),
    };

    renderContainer(localStore, feedSource);
    fireEvent.click(screen.getByRole("button", { name: /^refresh$/i }));

    expect(await screen.findByRole("button", { name: /refreshing/i })).toBeDisabled();

    resolveFetch({ status: "not-modified" });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^refresh$/i })).not.toBeDisabled(),
    );
  });

  it("renders one RefreshErrorChip per failed feed, never one aggregated message", async () => {
    const feedA = makeFeed({ id: "https://a.example/feed", title: "Feed A" });
    const feedB = makeFeed({ id: "https://b.example/feed", title: "Feed B" });
    const localStore = makeLocalStore({
      listFeeds: vi.fn().mockResolvedValue([feedA, feedB]),
      getFeed: vi.fn(async (id: string) => (id === feedA.id ? feedA : feedB)),
    });
    const feedSource: FeedSourcePort = {
      fetchFeed: vi.fn(async (url: string) =>
        url === feedA.id
          ? ({ status: "error", code: "UPSTREAM_TIMEOUT", message: "timed out" } satisfies FeedFetchResult)
          : ({ status: "error", code: "UPSTREAM_ERROR", message: "returned 500" } satisfies FeedFetchResult),
      ),
    };

    renderContainer(localStore, feedSource);
    fireEvent.click(screen.getByRole("button", { name: /^refresh$/i }));

    const alerts = await screen.findAllByRole("alert");
    expect(alerts).toHaveLength(2);
    expect(screen.getByText("Feed A")).toBeInTheDocument();
    expect(screen.getByText("Feed B")).toBeInTheDocument();
    expect(screen.getByText(/timed out/i)).toBeInTheDocument();
    expect(screen.getByText(/returned 500/i)).toBeInTheDocument();
  });
});
