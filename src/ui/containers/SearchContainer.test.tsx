import { opmlCodecStub } from "../../test/doubles/opmlCodecStub";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { createEntry, type Entry } from "../../domain/models/Entry";
import { createFeed, type Feed } from "../../domain/models/Feed";
import type { ClockPort } from "../../ports/ClockPort";
import type { FeedParserPort } from "../../ports/FeedParserPort";
import type { FeedSourcePort } from "../../ports/FeedSourcePort";
import type { LocalStorePort } from "../../ports/LocalStorePort";
import { ServicesProvider, type Services } from "../../app/providers/ServicesContext";
import { SEARCH_DEBOUNCE_MS, SearchContainer } from "./SearchContainer";

const clock: ClockPort = { now: () => "2026-08-01T00:00:00.000Z" };
const feedSource: FeedSourcePort = { fetchFeed: vi.fn() };
const feedParser: FeedParserPort = { parse: vi.fn() } as unknown as FeedParserPort;

function makeFeed(id: string, title: string, note: string | null = null): Feed {
  return {
    ...createFeed({
      id,
      url: id,
      normalizedUrl: id,
      title,
      folder: null,
      addedAt: "2026-08-01T00:00:00.000Z",
    }),
    note,
  };
}

function makeEntry(id: string, title: string, bodyHtml: string | null = null): Entry {
  return {
    ...createEntry({
      id,
      feedId: "feed-1",
      contentHash: id,
      title,
      link: `https://example.com/${id}`,
      publishedAt: "2026-08-01T00:00:00.000Z",
      fetchedAt: "2026-08-01T00:00:00.000Z",
      contentHtml: bodyHtml,
    }),
  };
}

function renderContainer(storeOverrides: Partial<LocalStorePort> = {}) {
  const localStore = {
    listFeeds: vi.fn().mockResolvedValue([makeFeed("feed-1", "Hacker News")]),
    listEntriesByPublished: vi
      .fn()
      .mockResolvedValue([makeEntry("e1", "Kafka in practice")]),
    ...storeOverrides,
  } as unknown as LocalStorePort;

  const services: Services = { localStore, clock, feedSource, feedParser, opmlCodec: opmlCodecStub };
  const onSelectResult = vi.fn();

  const rendered = render(
    <ServicesProvider services={services}>
      <SearchContainer onSelectResult={onSelectResult} />
    </ServicesProvider>,
  );

  return { ...rendered, localStore, onSelectResult };
}

/** Types into the box and lets the debounce elapse. */
async function type(text: string) {
  fireEvent.input(screen.getByRole("searchbox"), { target: { value: text } });
  await act(async () => {
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SearchContainer", () => {
  it("searches once typing pauses, and shows what it found", async () => {
    renderContainer();

    await type("kafka");

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /kafka in practice/i })).toBeInTheDocument(),
    );
  });

  it("does not search on every keystroke", async () => {
    // The whole library is read per search; five reads to answer one question
    // is exactly what the debounce exists to prevent.
    const { localStore } = renderContainer();

    fireEvent.input(screen.getByRole("searchbox"), { target: { value: "k" } });
    fireEvent.input(screen.getByRole("searchbox"), { target: { value: "ka" } });
    fireEvent.input(screen.getByRole("searchbox"), { target: { value: "kaf" } });
    await act(async () => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    });

    expect(localStore.listEntriesByPublished).toHaveBeenCalledTimes(1);
  });

  it("says it is searching while the reader waits", async () => {
    renderContainer();

    fireEvent.input(screen.getByRole("searchbox"), { target: { value: "kafka" } });

    expect(screen.getByRole("status")).toHaveTextContent("Searching…");
  });

  it("never shows one query's results under another query's box", async () => {
    // A slow search for "ka" landing after "kafka" has already answered would
    // show results that do not match what is in the box.
    let resolveSlow: ((entries: Entry[]) => void) | null = null;
    const listEntriesByPublished = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Entry[]>((resolve) => {
            resolveSlow = resolve;
          }),
      )
      .mockResolvedValue([makeEntry("e2", "Kafka the fast one")]);

    renderContainer({ listEntriesByPublished });

    await type("ka");
    await type("kafka");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /kafka the fast one/i })).toBeInTheDocument(),
    );

    // The first search finally answers, long after it stopped mattering.
    await act(async () => {
      resolveSlow?.([makeEntry("e1", "Kalimba stale result")]);
    });

    expect(screen.queryByRole("button", { name: /kalimba/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /kafka the fast one/i })).toBeInTheDocument();
  });

  it("goes quiet again when the box is emptied", async () => {
    renderContainer();
    await type("kafka");
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("1 match."));

    await type("");

    expect(screen.getByRole("status")).toHaveTextContent("");
    expect(screen.queryByRole("button", { name: /kafka in practice/i })).not.toBeInTheDocument();
  });

  it("clears the box on request", async () => {
    renderContainer();
    await type("kafka");

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));

    expect(screen.getByRole("searchbox")).toHaveValue("");
  });

  it("hands the picked result up instead of navigating itself", async () => {
    const { onSelectResult } = renderContainer();
    await type("kafka");
    await waitFor(() => screen.getByRole("button", { name: /kafka in practice/i }));

    fireEvent.click(screen.getByRole("button", { name: /kafka in practice/i }));

    expect(onSelectResult).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "entry", entryId: "e1", feedId: "feed-1" }),
    );
  });

  it("surfaces a failed search instead of showing an empty result", async () => {
    // "No matches" for a store that could not be read is a false answer.
    renderContainer({
      listEntriesByPublished: vi.fn().mockRejectedValue(new Error("IndexedDB is gone")),
    });

    await type("kafka");

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("IndexedDB is gone"),
    );
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("does not read the store for a query too short to match", async () => {
    const { localStore } = renderContainer();

    await type("k");

    expect(localStore.listFeeds).not.toHaveBeenCalled();
  });
});
