/**
 * End-to-end proof: the ONE test in the project that renders the real
 * composition -- `buildServices()` (real `idbLocalStore` over
 * `fake-indexeddb`, real `relayFeedSource`, real `feedParser`, real
 * `domPurifySanitizer`), real `ServicesProvider`/`SanitizerContext.Provider`,
 * and the real `App` -- with only the NETWORK BOUNDARY stubbed via `msw`
 * (`/api/feed`). Every container test elsewhere in this project uses test
 * doubles for the ports; this is the first and only place `subscribeToFeed`,
 * `refreshFeeds`, `toggleRead`, `toggleStar`, and `idbLocalStore` all run
 * for real, together, against a rendered UI.
 *
 * An earlier version found the sidebar's unread badge never updated,
 * violating a mandatory spec scenario, and no test caught it (357 passing
 * tests over a product showing a wrong number). This test is where that
 * class of gap gets closed: every state change below is asserted against
 * the rendered DOM, including the unread count moving in both directions.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { buildServices } from "../composition/buildServices";
import { ServicesProvider } from "../providers/ServicesContext";
import { SanitizerContext } from "../../ui/components/SafeHtml";
import { App } from "../App";

const FIXTURES_DIR = join(import.meta.dirname, "..", "..", "test", "fixtures", "feeds");
const RSS2_FIXTURE = readFileSync(join(FIXTURES_DIR, "rss2.xml"), "utf8");

// `rss2.xml` (also used by `feedParser.test.ts`) parses to feed title
// "Example Blog" with two entries; the first ("Post One") carries
// `contentHtml: "<p>Full <b>content</b> for post one.</p>"` -- real,
// feed-supplied HTML, which is what proves the reading pane renders
// FORMATTED content (a real `<b>` element), not the escaped literal string
// that wiring `SafeHtml` into `ReadingPane` addressed.
const FEED_URL = "https://example.com/feed.xml";

const server = setupServer(
  http.get("/api/feed", ({ request }) => {
    const target = new URL(request.url).searchParams.get("url");
    if (target !== FEED_URL) {
      return HttpResponse.json(
        { error: { code: "INVALID_URL", message: `unexpected relay target: ${target}` } },
        { status: 400 },
      );
    }
    return HttpResponse.text(RSS2_FIXTURE, {
      status: 200,
      headers: {
        "Content-Type": "application/rss+xml",
        ETag: '"e2e-etag-1"',
        "X-Relay-Origin-Status": "200",
      },
    });
  }),
);

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

async function renderRealApp() {
  const { services, sanitize } = await buildServices();
  return render(
    <ServicesProvider services={services}>
      <SanitizerContext.Provider value={sanitize}>
        <App />
      </SanitizerContext.Provider>
    </ServicesProvider>,
  );
}

describe("e2e: add a feed, read/unread, star -- real store, real services, network boundary stubbed", () => {
  it("adds a feed by URL, renders formatted entry content, toggles read/unread, and starring persists across a fresh mount", async () => {
    const { unmount } = await renderRealApp();

    // --- add a feed by URL -------------------------------------------
    await screen.findByText(/no feeds yet/i);
    fireEvent.input(screen.getByRole("textbox", { name: /feed url/i }), {
      target: { value: FEED_URL },
    });
    fireEvent.click(screen.getByRole("button", { name: /^add feed$/i }));

    expect(await screen.findByText(/added.*example blog/i)).toBeInTheDocument();

    // --- entries appear, with the sidebar's unread count at 2 --------
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^example blog, 2 unread$/i })).toBeInTheDocument(),
    );
    const postOneButton = await screen.findByRole("button", { name: /^post one/i });

    // --- open an entry: it renders FORMATTED (non-escaped) content ---
    fireEvent.click(postOneButton);
    const boldContent = await screen.findByText("content");
    expect(boldContent.tagName).toBe("B");

    // --- opening marks it read; the sidebar unread count decreases ---
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^example blog, 1 unread$/i })).toBeInTheDocument(),
    );
    const markUnreadButton = await screen.findByRole("button", { name: /^mark as unread$/i });

    // --- mark unread; the count increases again -----------------------
    fireEvent.click(markUnreadButton);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^example blog, 2 unread$/i })).toBeInTheDocument(),
    );

    // The assertion above alone PASSED on this exact bug -- `waitFor` polls
    // until its callback stops throwing, so it happily returns the instant
    // "2 unread" appears transiently, even if the auto-mark-on-open effect
    // immediately wrote the entry back to read afterward. It was passing
    // for the wrong reason on the very regression it was meant to prevent.
    // Assert the SETTLED state explicitly and from a second, independent
    // signal (the entry's own accessible name, not just the sidebar's
    // count) so a silent revert cannot hide behind either check alone.
    await waitFor(() => {
      expect(postOneButton).toHaveAccessibleName(/unread/i);
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(postOneButton).toHaveAccessibleName(/unread/i);
    expect(
      screen.getByRole("button", { name: /^example blog, 2 unread$/i }),
    ).toBeInTheDocument();

    // --- star it -------------------------------------------------------
    const starButton = await screen.findByRole("button", { name: /^star$/i });
    fireEvent.click(starButton);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^unstar$/i })).toBeInTheDocument(),
    );

    unmount();

    // --- it persists: a completely fresh mount, same underlying IDB --
    // A real page reload cannot be observed from this test process (no
    // live browser tool available in this execution environment, same
    // residual-check limitation noted throughout this project); a fresh
    // `buildServices()` call opening a NEW connection to the SAME
    // `fake-indexeddb`-backed database, without deleting it, is the
    // closest available proof of persistence beyond a single component
    // instance's in-memory state.
    await renderRealApp();

    // This used to assert "1 unread" here -- i.e. that the entry came back
    // READ after a fresh mount, even though the flow above explicitly
    // marked it unread right before starring it. That assertion was itself
    // the auto-revert bug's fingerprint: it only passed because the buggy
    // effect silently wrote the entry back to `read: 1` before this test
    // ever unmounted. The user's explicit "mark as unread" MUST survive a
    // reload -- the honest persisted state is "2 unread".
    await screen.findByRole("button", { name: /^example blog, 2 unread$/i });
    expect(
      await screen.findByRole("button", { name: /^post one.*unread.*starred$/i }),
    ).toBeInTheDocument();
  });
});
