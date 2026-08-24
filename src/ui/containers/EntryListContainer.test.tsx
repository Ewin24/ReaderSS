import { opmlCodecStub } from "../../test/doubles/opmlCodecStub";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/preact";
import type { ClockPort } from "../../ports/ClockPort";
import type { FeedParserPort } from "../../ports/FeedParserPort";
import type { FeedSourcePort } from "../../ports/FeedSourcePort";
import type { LocalStorePort } from "../../ports/LocalStorePort";
import { createEntry, type Entry } from "../../domain/models/Entry";
import { ServicesProvider } from "../../app/providers/ServicesContext";
import { EntryListContainer } from "./EntryListContainer";

function makeEntry(overrides: Partial<Entry> = {}): Entry {
  return {
    ...createEntry({
      id: "entry-1",
      feedId: "feed-1",
      contentHash: "hash",
      title: "IndexedDB in practice",
      link: "https://example.com/1",
      publishedAt: "2026-08-19T09:00:00.000Z",
      fetchedAt: "2026-08-19T09:00:00.000Z",
    }),
    ...overrides,
  };
}

function makeLocalStore(entry: Entry, overrides: Partial<LocalStorePort> = {}): LocalStorePort {
  return {
    getFeed: vi.fn(),
    listFeeds: vi.fn(),
    listFeedsByFolder: vi.fn(),
    putFeed: vi.fn(),
    putFeedWithEntries: vi.fn(),
    deleteFeed: vi.fn(),
    getEntry: vi.fn().mockResolvedValue(entry),
    getEntryByFeedAndGuid: vi.fn(),
    putEntry: vi.fn().mockResolvedValue(undefined),
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

const clock: ClockPort = { now: () => "2026-08-19T10:00:00.000Z" };
// `Services` includes `feedSource`; this container doesn't use it, so a
// bare stub is enough to satisfy the `Services` type.
const feedSource: FeedSourcePort = { fetchFeed: vi.fn() };
const feedParser: FeedParserPort = { parse: vi.fn() };

describe("EntryListContainer", () => {
  it("binds the read toggle to the real toggleRead service via the services context", async () => {
    const entry = makeEntry({ read: 0 });
    const localStore = makeLocalStore(entry);
    const onEntryChanged = vi.fn();

    render(
      <ServicesProvider services={{ localStore, clock, feedSource, feedParser, opmlCodec: opmlCodecStub }}>
        <EntryListContainer
          entries={[
            {
              id: entry.id,
              title: entry.title,
              feedTitle: "Hacker News",
              publishedAt: entry.publishedAt,
              read: entry.read,
              starred: entry.starred,
            },
          ]}
          selectedEntryId={null}
          onSelectEntry={vi.fn()}
          onEntryChanged={onEntryChanged}
        />
      </ServicesProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: `Mark "${entry.title}" as read` }));

    await waitFor(() => {
      expect(localStore.putEntry).toHaveBeenCalledWith(
        expect.objectContaining({ read: 1, readChangedAt: "2026-08-19T10:00:00.000Z" }),
      );
    });
    expect(onEntryChanged).toHaveBeenCalledWith(entry.id);
  });

  it("binds the star toggle to the real toggleStar service via the services context", async () => {
    const entry = makeEntry({ starred: 0 });
    const localStore = makeLocalStore(entry);

    render(
      <ServicesProvider services={{ localStore, clock, feedSource, feedParser, opmlCodec: opmlCodecStub }}>
        <EntryListContainer
          entries={[
            {
              id: entry.id,
              title: entry.title,
              feedTitle: "Hacker News",
              publishedAt: entry.publishedAt,
              read: entry.read,
              starred: entry.starred,
            },
          ]}
          selectedEntryId={null}
          onSelectEntry={vi.fn()}
        />
      </ServicesProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: `Star "${entry.title}"` }));

    await waitFor(() => {
      expect(localStore.putEntry).toHaveBeenCalledWith(
        expect.objectContaining({ starred: 1, starredChangedAt: "2026-08-19T10:00:00.000Z" }),
      );
    });
  });

  it("calls onToggleError, not onEntryChanged, when the read toggle write fails", async () => {
    const entry = makeEntry({ read: 0 });
    const localStore = makeLocalStore(entry, {
      putEntry: vi.fn().mockRejectedValue(new Error("IndexedDB quota exceeded")),
    });
    const onEntryChanged = vi.fn();
    const onToggleError = vi.fn();

    render(
      <ServicesProvider services={{ localStore, clock, feedSource, feedParser, opmlCodec: opmlCodecStub }}>
        <EntryListContainer
          entries={[
            {
              id: entry.id,
              title: entry.title,
              feedTitle: "Hacker News",
              publishedAt: entry.publishedAt,
              read: entry.read,
              starred: entry.starred,
            },
          ]}
          selectedEntryId={null}
          onSelectEntry={vi.fn()}
          onEntryChanged={onEntryChanged}
          onToggleError={onToggleError}
        />
      </ServicesProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: `Mark "${entry.title}" as read` }));

    await waitFor(() => {
      expect(onToggleError).toHaveBeenCalledWith(entry.id, "IndexedDB quota exceeded");
    });
    expect(onEntryChanged).not.toHaveBeenCalled();
  });

  it("throws when rendered without a ServicesProvider ancestor", () => {
    const entry = makeEntry();
    // Preact logs the thrown render error to the console via its own error
    // boundary handling; suppress that noise for this one assertion.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() =>
      render(
        <EntryListContainer
          entries={[
            {
              id: entry.id,
              title: entry.title,
              feedTitle: "Hacker News",
              publishedAt: entry.publishedAt,
              read: entry.read,
              starred: entry.starred,
            },
          ]}
          selectedEntryId={null}
          onSelectEntry={vi.fn()}
        />,
      ),
    ).toThrow(/ServicesProvider/);

    consoleError.mockRestore();
  });
});
