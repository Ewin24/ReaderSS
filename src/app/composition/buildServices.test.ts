import { afterEach, describe, expect, it, vi } from "vitest";
import { buildServices } from "./buildServices";

/**
 * Proves `buildServices()` wires REAL production adapters, not stubs
 * (design.md §1, "main.tsx is the only construction site"; task 10.1). Each
 * test below exercises actual behaviour of the underlying adapter rather
 * than just asserting a property exists on the returned object, so a
 * regression that wires a no-op stand-in in place of a real adapter fails
 * here.
 */
describe("buildServices", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("wires a real idbLocalStore: a feed written through it can be read back", async () => {
    const { services } = await buildServices();

    const feed = {
      id: "https://example.com/feed",
      url: "https://example.com/feed",
      normalizedUrl: "https://example.com/feed",
      title: "Example Feed",
      siteUrl: null,
      folder: null,
      etag: null,
      lastModified: null,
      lastFetchedAt: null,
      lastSuccessAt: null,
      lastError: null,
      addedAt: "2026-08-19T00:00:00.000Z",
      unstableGuid: 0 as const,
    };

    await services.localStore.putFeed(feed);

    await expect(services.localStore.getFeed(feed.id)).resolves.toEqual(feed);
  });

  it("wires clock.now() to a real, parseable ISO timestamp (not a fixed stub value)", async () => {
    const { services } = await buildServices();

    const before = Date.now();
    const now = services.clock.now();
    const after = Date.now();

    const parsed = new Date(now).getTime();
    expect(parsed).toBeGreaterThanOrEqual(before);
    expect(parsed).toBeLessThanOrEqual(after);
  });

  it("wires feedSource to the real relay endpoint at /api/feed", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("<rss></rss>", {
        status: 200,
        headers: { "Content-Type": "application/rss+xml" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { services } = await buildServices();
    await services.feedSource.fetchFeed("https://example.com/feed.xml", {
      etag: null,
      lastModified: null,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/feed?url="),
      expect.anything(),
    );
  });

  it("wires sanitize() to the real DOMPurify sanitizer: a <script> tag is stripped", async () => {
    const { sanitize } = await buildServices();

    const clean = sanitize("<p>hi</p><script>alert(1)</script>", "cache-key-1");

    expect(clean).toContain("<p>hi</p>");
    expect(clean).not.toContain("<script>");
  });
});
