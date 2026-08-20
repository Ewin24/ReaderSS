import { afterEach, describe, expect, test, vi } from "vitest";
import { RelayFeedSource } from "./relayFeedSource";

const NO_VALIDATORS = { etag: null, lastModified: null };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RelayFeedSource.fetchFeed", () => {
  test("calls the relay endpoint with the target url percent-encoded as a query parameter", async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () =>
        new Response("<rss></rss>", {
          status: 200,
          headers: { "Content-Type": "application/rss+xml", "X-Relay-Origin-Status": "200" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await new RelayFeedSource().fetchFeed("https://blog.example.com/feed.xml?a=b", NO_VALIDATORS);

    const requestedUrl = fetchMock.mock.calls[0][0] as string;
    expect(requestedUrl).toBe("/api/feed?url=https%3A%2F%2Fblog.example.com%2Ffeed.xml%3Fa%3Db");
  });

  test("returns an 'updated' result with the body, content type, and validators on 200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("<rss><channel><title>Example</title></channel></rss>", {
            status: 200,
            headers: {
              "Content-Type": "application/rss+xml",
              ETag: '"abc"',
              "Last-Modified": "Wed, 21 Oct 2015 07:28:00 GMT",
              "X-Relay-Origin-Status": "200",
            },
          }),
      ),
    );

    const result = await new RelayFeedSource().fetchFeed("https://blog.example.com/feed.xml", NO_VALIDATORS);

    expect(result.status).toBe("updated");
    if (result.status === "updated") {
      expect(result.body).toBe("<rss><channel><title>Example</title></channel></rss>");
      expect(result.contentType).toBe("application/rss+xml");
      expect(result.etag).toBe('"abc"');
      expect(result.lastModified).toBe("Wed, 21 Oct 2015 07:28:00 GMT");
    }
  });

  test("sends stored validators as If-None-Match / If-Modified-Since", async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => new Response(null, { status: 304, headers: { "X-Relay-Origin-Status": "304" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await new RelayFeedSource().fetchFeed("https://blog.example.com/feed.xml", {
      etag: '"abc"',
      lastModified: "Wed, 21 Oct 2015 07:28:00 GMT",
    });

    const sentHeaders = fetchMock.mock.calls[0][1]?.headers as Headers;
    expect(sentHeaders.get("If-None-Match")).toBe('"abc"');
    expect(sentHeaders.get("If-Modified-Since")).toBe("Wed, 21 Oct 2015 07:28:00 GMT");
  });

  test("returns a 'not-modified' result on 304, with no body field", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 304, headers: { "X-Relay-Origin-Status": "304" } })),
    );

    const result = await new RelayFeedSource().fetchFeed("https://blog.example.com/feed.xml", {
      etag: '"abc"',
      lastModified: null,
    });

    expect(result).toEqual({ status: "not-modified" });
  });

  test("returns a RELAY_UNAVAILABLE error on a 304 missing the relay's own marker header", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 304 })));

    const result = await new RelayFeedSource().fetchFeed("https://blog.example.com/feed.xml", {
      etag: '"abc"',
      lastModified: null,
    });

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.code).toBe("RELAY_UNAVAILABLE");
    }
  });

  test("maps a relay JSON error body to a typed 'error' result, preserving the relay's code and message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: {
                code: "UNSUPPORTED_CONTENT_TYPE",
                message: 'content type "text/html" is not a supported feed format',
                targetHost: "blog.example.com",
                upstreamStatus: null,
              },
            }),
            { status: 415, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );

    const result = await new RelayFeedSource().fetchFeed("https://blog.example.com/feed.xml", NO_VALIDATORS);

    expect(result).toEqual({
      status: "error",
      code: "UNSUPPORTED_CONTENT_TYPE",
      message: 'content type "text/html" is not a supported feed format',
    });
  });

  /**
   * `fetch` used to be called with no
   * `signal` at all, so a slow relay (cold start, throttling, or an
   * unhandled server-side path) left the
   * client waiting with no bounded worst case beyond the browser's own
   * generic timeout. `CLIENT_TIMEOUT` must be distinguishable from the
   * generic `NETWORK_ERROR` so the failure is specific, not generic.
   */
  test("passes a bounded AbortSignal to the relay fetch, and maps its abort to a distinct CLIENT_TIMEOUT code", async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new RelayFeedSource().fetchFeed("https://blog.example.com/feed.xml", NO_VALIDATORS);

    expect(fetchMock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.code).toBe("CLIENT_TIMEOUT");
    }
  });

  test("returns a NETWORK_ERROR result when the relay itself cannot be reached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );

    const result = await new RelayFeedSource().fetchFeed("https://blog.example.com/feed.xml", NO_VALIDATORS);

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.code).toBe("NETWORK_ERROR");
    }
  });

  test("falls back to UPSTREAM_ERROR when the error response body is not the expected JSON shape", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not json", { status: 500 })));

    const result = await new RelayFeedSource().fetchFeed("https://blog.example.com/feed.xml", NO_VALIDATORS);

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.code).toBe("UPSTREAM_ERROR");
    }
  });

  /**
   * Reproduces the real bug found by manual use: `npm run dev` used to run
   * `vite` alone, with no `/api/feed` route, so Vite's own SPA fallback
   * answered every request to it with `index.html` (status 200, no relay
   * marker header). The old code trusted any `response.ok` body as feed
   * content and handed the app's own HTML to `feedParser`, which reported
   * every single feed as "not-a-feed" -- an error about the user's feed the
   * code had never actually established, since the relay never ran. This
   * must be caught here, before the body is ever treated as feed content,
   * and reported as its own distinct, actionable condition.
   */
  test("returns a RELAY_UNAVAILABLE error when a 200 response is missing the relay's own marker header (relay never ran)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("<!doctype html><html><body>the app shell</body></html>", {
            status: 200,
            headers: { "Content-Type": "text/html" },
          }),
      ),
    );

    const result = await new RelayFeedSource().fetchFeed("https://blog.example.com/feed.xml", NO_VALIDATORS);

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.code).toBe("RELAY_UNAVAILABLE");
      expect(result.message.toLowerCase()).toContain("relay");
    }
  });

  test("returns a RELAY_UNAVAILABLE error for an HTML body even when the marker header happens to be absent on an error status too", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("<!doctype html><html><body>Cannot GET /api/feed</body></html>", {
            status: 404,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          }),
      ),
    );

    const result = await new RelayFeedSource().fetchFeed("https://blog.example.com/feed.xml", NO_VALIDATORS);

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.code).toBe("RELAY_UNAVAILABLE");
    }
  });

  test("still treats a genuine 200 response as feed content when the relay marker header is present", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("<rss><channel><title>Example</title></channel></rss>", {
            status: 200,
            headers: { "Content-Type": "application/rss+xml", "X-Relay-Origin-Status": "200" },
          }),
      ),
    );

    const result = await new RelayFeedSource().fetchFeed("https://blog.example.com/feed.xml", NO_VALIDATORS);

    expect(result.status).toBe("updated");
  });

  test("still treats a genuine relay JSON error as its own reported code, not RELAY_UNAVAILABLE", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: { code: "PAYLOAD_TOO_LARGE", message: "response body exceeded the 5242880-byte limit" },
            }),
            { status: 413, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );

    const result = await new RelayFeedSource().fetchFeed("https://blog.example.com/feed.xml", NO_VALIDATORS);

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.code).toBe("PAYLOAD_TOO_LARGE");
    }
  });
});
