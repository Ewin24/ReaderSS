/**
 * Container contract: the file's text really reaches `importOpml`, real
 * subscriptions are written through the real service chain, the export really
 * hands a file to the browser, and every failure path shows a message instead
 * of silently doing nothing.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { feedParser } from "../../adapters/feed/feedParser";
import { feedsmithOpmlCodec } from "../../adapters/opml/feedsmithOpmlCodec";
import { createFeed } from "../../domain/models/Feed";
import type { ClockPort } from "../../ports/ClockPort";
import type { FeedFetchResult, FeedSourcePort } from "../../ports/FeedSourcePort";
import type { LocalStorePort } from "../../ports/LocalStorePort";
import { ServicesProvider, type Services } from "../../app/providers/ServicesContext";
import { OpmlContainer } from "./OpmlContainer";

const clock: ClockPort = { now: () => "2024-06-01T00:00:00.000Z" };

function makeLocalStore(overrides: Partial<LocalStorePort> = {}): LocalStorePort {
  return {
    getFeed: vi.fn().mockResolvedValue(undefined),
    listFeeds: vi.fn().mockResolvedValue([]),
    listFeedsByFolder: vi.fn().mockResolvedValue([]),
    putFeed: vi.fn().mockResolvedValue(undefined),
    putFeedWithEntries: vi.fn().mockResolvedValue(undefined),
    addFeedWithEntries: vi.fn().mockResolvedValue("created"),
    deleteFeed: vi.fn().mockResolvedValue(undefined),
    getEntry: vi.fn().mockResolvedValue(undefined),
    getEntryByFeedAndGuid: vi.fn().mockResolvedValue(undefined),
    putEntry: vi.fn().mockResolvedValue(undefined),
    deleteEntry: vi.fn().mockResolvedValue(undefined),
    listEntriesByFeed: vi.fn().mockResolvedValue([]),
    listEntriesByFeedPublished: vi.fn().mockResolvedValue([]),
    listEntriesByPublished: vi.fn().mockResolvedValue([]),
    listUnreadEntries: vi.fn().mockResolvedValue([]),
    listStarredEntries: vi.fn().mockResolvedValue([]),
    getConfigValue: vi.fn().mockResolvedValue(undefined),
    putConfigValue: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as LocalStorePort;
}

const VALID_RSS_BODY = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Example Blog</title><link>https://example.com</link>
<description>desc</description><item><title>Post</title><link>https://example.com/p</link></item>
</channel></rss>`;

function okFetch(): FeedFetchResult {
  return {
    status: "updated",
    body: VALID_RSS_BODY,
    contentType: "application/rss+xml",
    etag: null,
    lastModified: null,
  };
}

function renderContainer(
  overrides: Partial<Services> = {},
  props: { onImported?: () => void } = {},
) {
  const services: Services = {
    localStore: makeLocalStore(),
    clock,
    feedSource: { fetchFeed: vi.fn().mockResolvedValue(okFetch()) } as FeedSourcePort,
    feedParser,
    opmlCodec: feedsmithOpmlCodec,
    ...overrides,
  };
  const rendered = render(
    <ServicesProvider services={services}>
      <OpmlContainer {...props} />
    </ServicesProvider>,
  );
  return { ...rendered, services };
}

const OPML = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0"><head><title>Subs</title></head><body>
<outline type="rss" text="One" xmlUrl="https://one.example.com/feed.xml"/>
</body></opml>`;

/**
 * jsdom's `File` has no working `text()` in every version, and the input's
 * `files` list is read-only, so both are installed explicitly. `text` is what
 * the container actually consumes.
 */
function chooseFile(text: string | (() => Promise<string>), name = "subs.opml") {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("no file input rendered");
  const file = {
    name,
    text: typeof text === "function" ? text : () => Promise.resolve(text),
  } as unknown as File;
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  fireEvent.change(input);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("OpmlContainer — import", () => {
  it("subscribes to the feeds in the chosen file and reports the summary", async () => {
    const { services } = renderContainer();

    chooseFile(OPML);

    expect(await screen.findByText(/1 added/i)).toBeInTheDocument();
    expect(services.localStore.addFeedWithEntries).toHaveBeenCalledTimes(1);
  });

  it("notifies the parent so the feed list can refresh, but only when something was added", async () => {
    const onImported = vi.fn();
    renderContainer(
      { localStore: makeLocalStore({ addFeedWithEntries: vi.fn().mockResolvedValue("duplicate") }) },
      { onImported },
    );

    chooseFile(OPML);

    expect(await screen.findByText(/1 already subscribed/i)).toBeInTheDocument();
    expect(onImported).not.toHaveBeenCalled();
  });

  it("notifies the parent after a successful import", async () => {
    const onImported = vi.fn();
    renderContainer({}, { onImported });

    chooseFile(OPML);

    await screen.findByText(/1 added/i);
    await waitFor(() => expect(onImported).toHaveBeenCalled());
  });

  it("says so when the file is not OPML at all", async () => {
    renderContainer();

    chooseFile("this is not opml");

    expect(await screen.findByText(/could not be read as opml/i)).toBeInTheDocument();
  });

  it("says so when the file is valid OPML but lists no feeds", async () => {
    renderContainer();

    chooseFile(
      `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0"><head><title>Subs</title></head>
<body><outline text="Empty folder"/></body></opml>`,
    );

    expect(await screen.findByText(/lists no feeds/i)).toBeInTheDocument();
  });

  it("reports a file that cannot be read instead of importing nothing silently", async () => {
    renderContainer();

    chooseFile(() => Promise.reject(new Error("file is gone")));

    expect(await screen.findByText(/file is gone/i)).toBeInTheDocument();
  });
});

describe("OpmlContainer — export", () => {
  it("hands the browser a downloadable OPML file named for the app", async () => {
    const feeds = [
      createFeed({
        id: "https://one.example.com/feed.xml",
        url: "https://one.example.com/feed.xml",
        normalizedUrl: "https://one.example.com/feed.xml",
        title: "One",
        folder: null,
        addedAt: "2024-06-01T00:00:00.000Z",
      }),
    ];
    const createObjectURL = vi.fn().mockReturnValue("blob:fake");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this);
    });

    renderContainer({ localStore: makeLocalStore({ listFeeds: vi.fn().mockResolvedValue(feeds) }) });
    fireEvent.click(screen.getByRole("button", { name: /export opml/i }));

    expect(await screen.findByText(/exported 1 subscription\./i)).toBeInTheDocument();
    expect(clicked).toHaveLength(1);
    expect(clicked[0].download).toBe("readerss-subscriptions.opml");
    // The blob URL is released rather than leaked for the document's lifetime.
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:fake");
    vi.unstubAllGlobals();
  });

  it("reports a store failure instead of downloading an empty file", async () => {
    renderContainer({
      localStore: makeLocalStore({
        listFeeds: vi.fn().mockRejectedValue(new Error("database is closed")),
      }),
    });

    fireEvent.click(screen.getByRole("button", { name: /export opml/i }));

    expect(await screen.findByText(/could not read your subscriptions/i)).toBeInTheDocument();
  });

  it("distinguishes a failed download from a failed export", async () => {
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn().mockImplementation(() => {
        throw new Error("blobs unavailable");
      }),
      revokeObjectURL: vi.fn(),
    });

    renderContainer();
    fireEvent.click(screen.getByRole("button", { name: /export opml/i }));

    expect(await screen.findByText(/the download could not start/i)).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
