import { afterEach, describe, expect, it, vi } from "vitest";
import { within } from "@testing-library/preact";
import type { ClockPort } from "../../ports/ClockPort";
import type { FeedParserPort } from "../../ports/FeedParserPort";
import type { FeedSourcePort } from "../../ports/FeedSourcePort";
import type { LocalStorePort } from "../../ports/LocalStorePort";
import type { Services } from "../providers/ServicesContext";
import { buildServices } from "./buildServices";
import { bootstrapApp, renderStartupFailure } from "./bootstrap";

vi.mock("./buildServices", () => ({
  buildServices: vi.fn(),
}));

const clock: ClockPort = { now: () => "2026-08-19T10:00:00.000Z" };
const feedSource: FeedSourcePort = { fetchFeed: vi.fn() };
const feedParser: FeedParserPort = { parse: vi.fn() };

function makeLocalStore(): LocalStorePort {
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
  } as unknown as LocalStorePort;
}

const buildServicesMock = vi.mocked(buildServices);

/**
 * `toBeInTheDocument()` requires the element to actually be attached to
 * `document` -- a bare `document.createElement("div")` is not, so every
 * assertion against it would fail regardless of `bootstrapApp`'s behavior.
 * Attaches a fresh root to `document.body` for the test and detaches it
 * afterward (the module-level `afterEach` below only runs
 * `@testing-library/preact`'s `cleanup()`, which does not know about roots
 * this file manages by hand).
 */
function makeAttachedRoot(): HTMLElement {
  const root = document.createElement("div");
  document.body.appendChild(root);
  return root;
}

afterEach(() => {
  vi.clearAllMocks();
  document.body.replaceChildren();
});

/**
 * Finding 1 (Slice 10a correction round, BLOCKER): `main.tsx` awaited
 * `buildServices()` -- which opens IndexedDB -- before the first `render()`,
 * with no `.catch()` anywhere and no `unhandledrejection` handler in
 * `src/**`. If `openReaderSSDatabase()` rejects (Slice 2's own
 * `DatabaseBlockedError`/timeout; Safari private browsing reaches the same
 * place), `render()` is never reached, `<ErrorBoundary>` never mounts (it
 * only catches errors during rendering, not a rejection before the tree
 * exists), and the user gets a permanently blank page. `bootstrapApp` closes
 * this: it never lets the rejection escape uncaught, and the failure branch
 * renders a visible, actionable fallback directly into the root element.
 */
describe("bootstrapApp", () => {
  it("renders the app tree into the root element when buildServices resolves", async () => {
    const services: Services = { localStore: makeLocalStore(), clock, feedSource, feedParser };
    buildServicesMock.mockResolvedValue({ services, sanitize: (html) => html });
    const root = makeAttachedRoot();

    await bootstrapApp(root);

    expect(within(root).getByRole("navigation", { name: "Feeds" })).toBeInTheDocument();
    expect(root.children.length).toBeGreaterThan(0);
  });

  it("renders a visible fallback into the root element instead of leaving it blank when buildServices rejects", async () => {
    buildServicesMock.mockRejectedValue(new Error("Database blocked: timed out waiting for other tabs"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const root = makeAttachedRoot();

    await bootstrapApp(root);

    expect(root.children.length).toBeGreaterThan(0);
    expect(within(root).getByRole("alert")).toBeInTheDocument();
    expect(within(root).getByText(/could not start/i)).toBeInTheDocument();
    expect(
      within(root).getByText(/database blocked: timed out waiting for other tabs/i),
    ).toBeInTheDocument();
    expect(within(root).getByText(/^reload this page\.$/i)).toBeInTheDocument();

    consoleError.mockRestore();
  });
});

describe("renderStartupFailure", () => {
  it("clears any existing content and renders an actionable, visible message", () => {
    const root = makeAttachedRoot();
    const stale = document.createElement("p");
    stale.textContent = "stale content";
    root.appendChild(stale);

    renderStartupFailure(root, new Error("IDB closed"));

    expect(within(root).queryByText("stale content")).not.toBeInTheDocument();
    expect(within(root).getByRole("alert")).toBeInTheDocument();
    expect(within(root).getByText(/idb closed/i)).toBeInTheDocument();
    expect(within(root).getByText(/private browsing and storage/i)).toBeInTheDocument();
    expect(within(root).getByText(/close other/i)).toBeInTheDocument();
  });

  it("stringifies a non-Error rejection instead of throwing", () => {
    const root = makeAttachedRoot();

    expect(() => renderStartupFailure(root, "plain string rejection")).not.toThrow();
    expect(within(root).getByText(/plain string rejection/i)).toBeInTheDocument();
  });
});
