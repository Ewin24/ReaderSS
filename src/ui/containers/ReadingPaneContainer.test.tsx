import { opmlCodecStub } from "../../test/doubles/opmlCodecStub";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { useCallback, useState } from "preact/hooks";
import type { ClockPort } from "../../ports/ClockPort";
import type { FeedParserPort } from "../../ports/FeedParserPort";
import type { FeedSourcePort } from "../../ports/FeedSourcePort";
import type { LocalStorePort } from "../../ports/LocalStorePort";
import { createEntry, type Entry } from "../../domain/models/Entry";
import { ServicesProvider } from "../../app/providers/ServicesContext";
import { ReadingPaneContainer } from "./ReadingPaneContainer";
import type { ReadingPaneEntry } from "../components/ReadingPane";

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

function toReadingPaneEntry(entry: Entry): ReadingPaneEntry {
  return {
    id: entry.id,
    title: entry.title,
    feedTitle: "Hacker News",
    publishedAt: entry.publishedAt,
    link: entry.link,
    summary: entry.summaryHtml,
    content: entry.contentHtml,
    read: entry.read,
    starred: entry.starred,
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

/**
 * Renders `ReadingPaneContainer` with a LIVE entry prop that updates after
 * every `onEntryChanged` -- the same round trip `App.tsx`'s own
 * `handleEntryChanged` performs in production (re-fetch via `getEntry`,
 * feed the fresh object back down). A STATIC entry prop (every other test
 * in this file, before this one) can never reproduce the auto-mark-on-open
 * effect's revert bug, because the effect's dependency on the live entry
 * never actually changes if the `entry` prop itself never changes between
 * renders.
 */
function LiveEntryHarness({
  initialEntry,
  localStore,
}: {
  initialEntry: ReadingPaneEntry;
  localStore: LocalStorePort;
}) {
  const [entry, setEntry] = useState(initialEntry);
  const handleEntryChanged = useCallback(
    (entryId: string) => {
      localStore.getEntry(entryId).then((fresh) => {
        if (fresh === undefined) return;
        setEntry(toReadingPaneEntry(fresh));
      });
    },
    [localStore],
  );
  return <ReadingPaneContainer entry={entry} onEntryChanged={handleEntryChanged} />;
}

const clock: ClockPort = { now: () => "2026-08-19T10:00:00.000Z" };
// `Services` includes `feedSource`; this container doesn't use it, so a
// bare stub is enough to satisfy the `Services` type.
const feedSource: FeedSourcePort = { fetchFeed: vi.fn() };
const feedParser: FeedParserPort = { parse: vi.fn() };

describe("ReadingPaneContainer", () => {
  it("marks an unread entry read via toggleRead as soon as it opens", async () => {
    const entry = makeEntry({ read: 0 });
    const localStore = makeLocalStore(entry);
    const onEntryChanged = vi.fn();

    render(
      <ServicesProvider services={{ localStore, clock, feedSource, feedParser, opmlCodec: opmlCodecStub }}>
        <ReadingPaneContainer entry={toReadingPaneEntry(entry)} onEntryChanged={onEntryChanged} />
      </ServicesProvider>,
    );

    await waitFor(() => {
      expect(localStore.putEntry).toHaveBeenCalledWith(
        expect.objectContaining({ read: 1, readChangedAt: "2026-08-19T10:00:00.000Z" }),
      );
    });
    expect(onEntryChanged).toHaveBeenCalledWith(entry.id);
  });

  it("does not call toggleRead again for an entry that is already read", async () => {
    const entry = makeEntry({ read: 1, readChangedAt: "2026-08-01T00:00:00.000Z" });
    const localStore = makeLocalStore(entry);

    render(
      <ServicesProvider services={{ localStore, clock, feedSource, feedParser, opmlCodec: opmlCodecStub }}>
        <ReadingPaneContainer entry={toReadingPaneEntry(entry)} />
      </ServicesProvider>,
    );

    // Give any stray effect a turn to run before asserting its absence.
    await Promise.resolve();
    await Promise.resolve();

    expect(localStore.putEntry).not.toHaveBeenCalled();
  });

  it("wires the pane's 'Mark as unread' action to toggleRead", async () => {
    const entry = makeEntry({ read: 1, readChangedAt: "2026-08-01T00:00:00.000Z" });
    const localStore = makeLocalStore(entry);

    render(
      <ServicesProvider services={{ localStore, clock, feedSource, feedParser, opmlCodec: opmlCodecStub }}>
        <ReadingPaneContainer entry={toReadingPaneEntry(entry)} />
      </ServicesProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /mark as unread/i }));

    await waitFor(() => {
      expect(localStore.putEntry).toHaveBeenCalledWith(
        expect.objectContaining({ read: 0, readChangedAt: "2026-08-19T10:00:00.000Z" }),
      );
    });
  });

  it("calls onToggleError, not onEntryChanged, when the auto mark-as-read write fails on open", async () => {
    const entry = makeEntry({ read: 0 });
    const localStore = makeLocalStore(entry, {
      putEntry: vi.fn().mockRejectedValue(new Error("IndexedDB quota exceeded")),
    });
    const onEntryChanged = vi.fn();
    const onToggleError = vi.fn();

    render(
      <ServicesProvider services={{ localStore, clock, feedSource, feedParser, opmlCodec: opmlCodecStub }}>
        <ReadingPaneContainer
          entry={toReadingPaneEntry(entry)}
          onEntryChanged={onEntryChanged}
          onToggleError={onToggleError}
        />
      </ServicesProvider>,
    );

    await waitFor(() => {
      expect(onToggleError).toHaveBeenCalledWith(entry.id, "IndexedDB quota exceeded");
    });
    expect(onEntryChanged).not.toHaveBeenCalled();
  });

  it("calls onToggleError when the pane's star toggle write fails", async () => {
    const entry = makeEntry({ read: 1, starred: 0 });
    const localStore = makeLocalStore(entry, {
      putEntry: vi.fn().mockRejectedValue(new Error("IndexedDB quota exceeded")),
    });
    const onToggleError = vi.fn();

    render(
      <ServicesProvider services={{ localStore, clock, feedSource, feedParser, opmlCodec: opmlCodecStub }}>
        <ReadingPaneContainer entry={toReadingPaneEntry(entry)} onToggleError={onToggleError} />
      </ServicesProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Star" }));

    await waitFor(() => {
      expect(onToggleError).toHaveBeenCalledWith(entry.id, "IndexedDB quota exceeded");
    });
  });

  it("wires the pane's star toggle to toggleStar", async () => {
    const entry = makeEntry({ read: 1, starred: 0 });
    const localStore = makeLocalStore(entry);

    render(
      <ServicesProvider services={{ localStore, clock, feedSource, feedParser, opmlCodec: opmlCodecStub }}>
        <ReadingPaneContainer entry={toReadingPaneEntry(entry)} />
      </ServicesProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Star" }));

    await waitFor(() => {
      expect(localStore.putEntry).toHaveBeenCalledWith(
        expect.objectContaining({ starred: 1, starredChangedAt: "2026-08-19T10:00:00.000Z" }),
      );
    });
  });

  it("keeps an entry unread after an explicit 'mark as unread' click when the entry prop is LIVE, not static", async () => {
    const entry = makeEntry({ read: 1, readChangedAt: "2026-08-01T00:00:00.000Z" });
    let currentEntry = entry;
    const localStore = makeLocalStore(entry, {
      getEntry: vi.fn(async () => currentEntry),
      putEntry: vi.fn(async (updated: Entry) => {
        currentEntry = updated;
      }),
    });

    render(
      <ServicesProvider services={{ localStore, clock, feedSource, feedParser, opmlCodec: opmlCodecStub }}>
        <LiveEntryHarness initialEntry={toReadingPaneEntry(entry)} localStore={localStore} />
      </ServicesProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /^mark as unread$/i }));

    await waitFor(() => {
      expect(localStore.putEntry).toHaveBeenCalledWith(expect.objectContaining({ read: 0 }));
    });

    // Give the LIVE entry prop time to round-trip back through
    // `onEntryChanged` -- exactly the fresh, changed `entry.read` value
    // that, without the id-based guard in `ReadingPaneContainer`, would
    // re-trigger the auto-mark-on-open effect and silently write the entry
    // back to `read: 1`.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(localStore.putEntry).toHaveBeenCalledTimes(1);
    expect(currentEntry.read).toBe(0);
  });
});
