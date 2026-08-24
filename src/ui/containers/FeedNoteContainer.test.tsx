import { opmlCodecStub } from "../../test/doubles/opmlCodecStub";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { createFeed, type Feed } from "../../domain/models/Feed";
import type { ClockPort } from "../../ports/ClockPort";
import type { FeedParserPort } from "../../ports/FeedParserPort";
import type { FeedSourcePort } from "../../ports/FeedSourcePort";
import type { LocalStorePort } from "../../ports/LocalStorePort";
import { ServicesProvider, type Services } from "../../app/providers/ServicesContext";
import { FeedNoteContainer } from "./FeedNoteContainer";

const FEED_ID = "https://example.com/feed";
const clock: ClockPort = { now: () => "2024-06-01T00:00:00.000Z" };
const feedSource: FeedSourcePort = { fetchFeed: vi.fn() };
const feedParser: FeedParserPort = { parse: vi.fn() } as unknown as FeedParserPort;

function makeFeed(note: string | null = null): Feed {
  return {
    ...createFeed({
      id: FEED_ID,
      url: FEED_ID,
      normalizedUrl: FEED_ID,
      title: "Ars Technica",
      folder: null,
      addedAt: "2024-06-01T00:00:00.000Z",
    }),
    note,
  };
}

function renderContainer(
  storeOverrides: Partial<LocalStorePort> = {},
  props: Partial<Parameters<typeof FeedNoteContainer>[0]> = {},
) {
  const localStore = {
    getFeed: vi.fn().mockResolvedValue(makeFeed()),
    putFeed: vi.fn().mockResolvedValue(undefined),
    ...storeOverrides,
  } as unknown as LocalStorePort;

  const services: Services = {
    localStore,
    clock,
    feedSource,
    feedParser,
    opmlCodec: opmlCodecStub,
  };

  const rendered = render(
    <ServicesProvider services={services}>
      <FeedNoteContainer
        feedId={FEED_ID}
        feedTitle="Ars Technica"
        note={null}
        {...props}
      />
    </ServicesProvider>,
  );
  return { ...rendered, localStore };
}

describe("FeedNoteContainer", () => {
  it("renders nothing when no feed is selected", () => {
    const { container } = renderContainer({}, { feedId: null, feedTitle: null });

    // `container.innerHTML` is not used even to READ: the repo-wide sink ban
    // matches the property name itself, and a test is not a reason to weaken it.
    expect(container.firstChild).toBeNull();
  });

  it("writes the note through the real service and reports it up", async () => {
    const onNoteSaved = vi.fn();
    const { localStore } = renderContainer({}, { onNoteSaved });

    fireEvent.click(screen.getByRole("button", { name: /add a note/i }));
    fireEvent.input(screen.getByRole("textbox"), { target: { value: "  long-form only  " } });
    fireEvent.click(screen.getByRole("button", { name: /save note/i }));

    await waitFor(() => expect(onNoteSaved).toHaveBeenCalledWith(FEED_ID, "long-form only"));
    expect(localStore.putFeed).toHaveBeenCalledWith(
      expect.objectContaining({ note: "long-form only" }),
    );
  });

  it("reports a cleared note as null", async () => {
    const onNoteSaved = vi.fn();
    renderContainer({ getFeed: vi.fn().mockResolvedValue(makeFeed("old")) }, {
      note: "old",
      onNoteSaved,
    });

    fireEvent.click(screen.getByRole("button", { name: /edit note/i }));
    fireEvent.input(screen.getByRole("textbox"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: /save note/i }));

    await waitFor(() => expect(onNoteSaved).toHaveBeenCalledWith(FEED_ID, null));
  });

  it("shows a failed write instead of pretending the note was saved", async () => {
    const onNoteSaved = vi.fn();
    renderContainer({ putFeed: vi.fn().mockRejectedValue(new Error("quota exceeded")) }, {
      onNoteSaved,
    });

    fireEvent.click(screen.getByRole("button", { name: /add a note/i }));
    fireEvent.input(screen.getByRole("textbox"), { target: { value: "note" } });
    fireEvent.click(screen.getByRole("button", { name: /save note/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/quota exceeded/i);
    expect(onNoteSaved).not.toHaveBeenCalled();
  });

  it("says so when the feed was removed while the note was open", async () => {
    renderContainer({ getFeed: vi.fn().mockResolvedValue(undefined) });

    fireEvent.click(screen.getByRole("button", { name: /add a note/i }));
    fireEvent.input(screen.getByRole("textbox"), { target: { value: "note" } });
    fireEvent.click(screen.getByRole("button", { name: /save note/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/no longer exists/i);
  });
});
