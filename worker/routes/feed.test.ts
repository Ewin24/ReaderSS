import { afterEach, describe, expect, test, vi } from "vitest";
import { handleFeedRequest } from "./feed";

const DEPLOYMENT_ORIGIN = "https://readerss.example.workers.dev";

function relayRequest(targetUrl: string, extraHeaders: Record<string, string> = {}): Request {
  const relayUrl = `${DEPLOYMENT_ORIGIN}/api/feed?url=${encodeURIComponent(targetUrl)}`;
  return new Request(relayUrl, {
    headers: { Origin: DEPLOYMENT_ORIGIN, ...extraHeaders },
  });
}

async function errorBody(
  response: Response,
): Promise<{ error: { code: string; message: string; targetHost: string | null; upstreamStatus: number | null } }> {
  return response.json();
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("handleFeedRequest — origin and target validation", () => {
  test("rejects a request whose Origin does not match the deployment origin, as FORBIDDEN_ORIGIN 403", async () => {
    const request = new Request(`${DEPLOYMENT_ORIGIN}/api/feed?url=https://blog.example.com/feed.xml`, {
      headers: { Origin: "https://evil.example" },
    });
    const response = await handleFeedRequest(request);
    expect(response.status).toBe(403);
    expect((await errorBody(response)).error.code).toBe("FORBIDDEN_ORIGIN");
  });

  test("rejects a missing url query parameter as INVALID_URL 400", async () => {
    const request = new Request(`${DEPLOYMENT_ORIGIN}/api/feed`, { headers: { Origin: DEPLOYMENT_ORIGIN } });
    const response = await handleFeedRequest(request);
    expect(response.status).toBe(400);
    expect((await errorBody(response)).error.code).toBe("INVALID_URL");
  });

  test("rejects a loopback target as BLOCKED_TARGET 403, without calling fetch", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const request = relayRequest("http://127.0.0.1/feed.xml");
    const response = await handleFeedRequest(request);
    expect(response.status).toBe(403);
    expect((await errorBody(response)).error.code).toBe("BLOCKED_TARGET");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("handleFeedRequest — content-type allow-list", () => {
  test("accepts text/plain (design.md §2: allowed for misconfigured feed servers)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<rss></rss>", { status: 200, headers: { "Content-Type": "text/plain" } })),
    );
    const response = await handleFeedRequest(relayRequest("https://blog.example.com/feed.xml"));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("<rss></rss>");
  });

  test("rejects text/html as UNSUPPORTED_CONTENT_TYPE 415", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html></html>", { status: 200, headers: { "Content-Type": "text/html" } })),
    );
    const response = await handleFeedRequest(relayRequest("https://blog.example.com/feed.xml"));
    expect(response.status).toBe(415);
    expect((await errorBody(response)).error.code).toBe("UNSUPPORTED_CONTENT_TYPE");
  });

  test("rejects application/octet-stream as UNSUPPORTED_CONTENT_TYPE 415", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(new Uint8Array([1, 2, 3]), {
            status: 200,
            headers: { "Content-Type": "application/octet-stream" },
          }),
      ),
    );
    const response = await handleFeedRequest(relayRequest("https://blog.example.com/feed.xml"));
    expect(response.status).toBe(415);
    expect((await errorBody(response)).error.code).toBe("UNSUPPORTED_CONTENT_TYPE");
  });

  test("accepts application/rss+xml with charset parameters ignored", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("<rss></rss>", {
            status: 200,
            headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
          }),
      ),
    );
    const response = await handleFeedRequest(relayRequest("https://blog.example.com/feed.xml"));
    expect(response.status).toBe(200);
  });
});

describe("handleFeedRequest — timeout", () => {
  test("returns UPSTREAM_TIMEOUT 504 when the outbound fetch aborts via AbortSignal.timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("The operation timed out.", "TimeoutError");
      }),
    );
    const response = await handleFeedRequest(relayRequest("https://slow.example.com/feed.xml"));
    expect(response.status).toBe(504);
    expect((await errorBody(response)).error.code).toBe("UPSTREAM_TIMEOUT");
  });

  /**
   * The WHATWG Fetch spec says aborting a fetch's controller also errors
   * its response body stream, not just the header-wait phase.
   * Before the fix, `readLimitedBody`'s catch only handled
   * `PayloadTooLargeError` and rethrow everything else uncaught at
   * `worker/routes/feed.ts:182`, so a mid-stream abort escaped this route
   * entirely instead of returning JSON.
   */
  test("returns UPSTREAM_TIMEOUT 504 as JSON when the response body stream aborts mid-read, not an unhandled throw", async () => {
    const abortingStream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new DOMException("The operation timed out.", "TimeoutError"));
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(abortingStream, { status: 200, headers: { "Content-Type": "application/rss+xml" } }),
      ),
    );
    const response = await handleFeedRequest(relayRequest("https://slow-body.example.com/feed.xml"));
    expect(response.status).toBe(504);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect((await errorBody(response)).error.code).toBe("UPSTREAM_TIMEOUT");
  });

  /**
   * Before the fix, `AbortSignal.timeout` was created fresh inside the
   * per-hop loop, so a redirect chain could consume
   * up to ~MAX_REDIRECTS x UPSTREAM_TIMEOUT_MS while every individual hop
   * stayed under its own fresh budget. This test proves ONE deadline is
   * shared across the whole request: hop 3 would comfortably finish inside
   * any *fresh* per-hop budget (3s, alone), but 8s has already elapsed by
   * the time hop 3 starts, so a correctly cumulative 10s budget has only 2s
   * left and must trip before hop 3 completes.
   */
  test("bounds total relay latency to the cumulative 10s budget across redirect hops, not a fresh budget per hop", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi
        .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
        .mockImplementationOnce(async () => {
          await vi.advanceTimersByTimeAsync(4_000); // hop 1: 4s
          return new Response(null, { status: 302, headers: { Location: "https://hop1.example.com/feed.xml" } });
        })
        .mockImplementationOnce(async () => {
          await vi.advanceTimersByTimeAsync(4_000); // hop 2: 4s -> 8s elapsed total
          return new Response(null, { status: 302, headers: { Location: "https://hop2.example.com/feed.xml" } });
        })
        .mockImplementationOnce(async (_input, init) => {
          await vi.advanceTimersByTimeAsync(3_000); // hop 3: 3s -> 11s elapsed total
          if (init?.signal?.aborted) {
            throw init.signal.reason;
          }
          return new Response("<rss></rss>", { status: 200, headers: { "Content-Type": "application/rss+xml" } });
        });
      vi.stubGlobal("fetch", fetchMock);

      const response = await handleFeedRequest(relayRequest("https://hop0.example.com/feed.xml"));

      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(response.status).toBe(504);
      expect((await errorBody(response)).error.code).toBe("UPSTREAM_TIMEOUT");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("handleFeedRequest — redirects", () => {
  test("follows a redirect and re-validates the Location against targetUrlGuard", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { Location: "https://cdn.example.com/feed.xml" } }),
      )
      .mockResolvedValueOnce(
        new Response("<rss>redirected</rss>", { status: 200, headers: { "Content-Type": "application/rss+xml" } }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const response = await handleFeedRequest(relayRequest("https://blog.example.com/feed.xml"));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("<rss>redirected</rss>");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  /**
   * Every redirect test in this file passes whenever the mock returns a
   * 3xx `Response` directly, REGARDLESS of the
   * `redirect` option actually requested — the mock doesn't enforce it. This
   * is the whole SSRF redirect defence: the guard only sees each hop's
   * `Location` because `fetch` is called with `redirect: "manual"`. If a
   * future refactor drops that option, the real Workers runtime auto-follows
   * redirects, the guard never re-runs on intermediate hops, and a chain
   * ending on a blocked host is fetched anyway — while every other redirect
   * test here, including the one rejecting exactly that chain, would stay
   * green. This test protects that SSRF boundary from a silent regression.
   */
  test("calls the upstream fetch with redirect: 'manual' so every hop is re-validated by targetUrlGuard (SSRF boundary regression guard)", async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => new Response("<rss></rss>", { status: 200, headers: { "Content-Type": "application/rss+xml" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await handleFeedRequest(relayRequest("https://blog.example.com/feed.xml"));
    expect(fetchMock.mock.calls[0][1]?.redirect).toBe("manual");
  });

  /**
   * The attacker-controlled case from the Threat Matrix
   * ("Relay target routing"): a redirect chain that is public on hop 1 and
   * loopback on hop 2. The
   * guard must re-run on the Location header, not just on the original
   * `url` parameter.
   */
  test("rejects a redirect chain that is public on hop 1 and loopback on hop 2, as BLOCKED_TARGET reporting the rejected hop's hostname", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { Location: "http://169.254.169.254/latest/meta-data" } }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const response = await handleFeedRequest(relayRequest("https://public-looking.example.com/feed.xml"));
    expect(response.status).toBe(403);
    const body = await errorBody(response);
    expect(body.error.code).toBe("BLOCKED_TARGET");
    // Must name the hop that was ACTUALLY rejected (hop 2, the loopback
    // metadata address), not hop 1's safe,
    // previously-validated hostname — misleading anyone triaging an SSRF
    // attempt on a multi-hop chain.
    expect(body.error.targetHost).toBe("169.254.169.254");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  /**
   * `new URL(location, guardResult.url)` was unguarded — a malformed
   * `Location` on a 3xx response throws
   * synchronously and previously escaped `handleFeedRequest` entirely
   * instead of returning the documented JSON contract.
   */
  test("maps a malformed redirect Location header to a taxonomy JSON error instead of throwing", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: "http://[not-a-valid-host" } }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await handleFeedRequest(relayRequest("https://blog.example.com/feed.xml"));
    expect(response.status).toBe(502);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect((await errorBody(response)).error.code).toBe("UPSTREAM_ERROR");
  });

  test("caps redirects at 3 hops and returns TOO_MANY_REDIRECTS 502 on the 4th", async () => {
    const redirectTo = (n: number) =>
      new Response(null, { status: 302, headers: { Location: `https://hop${n}.example.com/feed.xml` } });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(redirectTo(1))
      .mockResolvedValueOnce(redirectTo(2))
      .mockResolvedValueOnce(redirectTo(3))
      .mockResolvedValueOnce(redirectTo(4));
    vi.stubGlobal("fetch", fetchMock);
    const response = await handleFeedRequest(relayRequest("https://hop0.example.com/feed.xml"));
    expect(response.status).toBe(502);
    expect((await errorBody(response)).error.code).toBe("TOO_MANY_REDIRECTS");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});

describe("handleFeedRequest — upstream errors", () => {
  test("returns UPSTREAM_ERROR 502 with upstreamStatus set when the origin answers non-2xx/304", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not found", { status: 404 })));
    const response = await handleFeedRequest(relayRequest("https://blog.example.com/feed.xml"));
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.error.code).toBe("UPSTREAM_ERROR");
    expect(body.error.upstreamStatus).toBe(404);
  });

  test("returns UPSTREAM_ERROR 502 when the fetch itself rejects with a network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    const response = await handleFeedRequest(relayRequest("https://unreachable.example.com/feed.xml"));
    expect(response.status).toBe(502);
    expect((await errorBody(response)).error.code).toBe("UPSTREAM_ERROR");
  });
});

describe("handleFeedRequest — payload size", () => {
  test("returns PAYLOAD_TOO_LARGE 413 when the streamed body exceeds the 5 MiB cap", async () => {
    const bigStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(6 * 1024 * 1024).fill(1));
        controller.close();
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(bigStream, { status: 200, headers: { "Content-Type": "application/rss+xml" } }),
      ),
    );
    const response = await handleFeedRequest(relayRequest("https://huge.example.com/feed.xml"));
    expect(response.status).toBe(413);
    expect((await errorBody(response)).error.code).toBe("PAYLOAD_TOO_LARGE");
  });
});

describe("handleFeedRequest — conditional GET", () => {
  test("forwards If-None-Match to the origin", async () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => new Response("<rss></rss>", { status: 200, headers: { "Content-Type": "application/rss+xml" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await handleFeedRequest(relayRequest("https://blog.example.com/feed.xml", { "If-None-Match": '"abc"' }));
    const sentHeaders = fetchMock.mock.calls[0][1]?.headers as Headers;
    expect(sentHeaders.get("if-none-match")).toBe('"abc"');
  });

  test("returns 304 with an empty body and echoed validators when the origin answers 304", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 304, headers: { ETag: '"abc"' } })),
    );
    const response = await handleFeedRequest(
      relayRequest("https://blog.example.com/feed.xml", { "If-None-Match": '"abc"' }),
    );
    expect(response.status).toBe(304);
    expect(await response.text()).toBe("");
    expect(response.headers.get("etag")).toBe('"abc"');
    expect(response.headers.get("x-relay-origin-status")).toBe("304");
  });
});

describe("handleFeedRequest — response headers", () => {
  test("sets Access-Control-Allow-Origin to the exact deployment origin, and Vary: Origin, never '*'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response("<rss></rss>", { status: 200, headers: { "Content-Type": "application/rss+xml" } }),
      ),
    );
    const response = await handleFeedRequest(relayRequest("https://blog.example.com/feed.xml"));
    expect(response.headers.get("access-control-allow-origin")).toBe(DEPLOYMENT_ORIGIN);
    expect(response.headers.get("access-control-allow-origin")).not.toBe("*");
    expect(response.headers.get("vary")).toBe("Origin");
  });

  test("sets X-Relay-Origin-Status to the upstream's status code on a successful fetch", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response("<rss></rss>", { status: 200, headers: { "Content-Type": "application/rss+xml" } }),
      ),
    );
    const response = await handleFeedRequest(relayRequest("https://blog.example.com/feed.xml"));
    expect(response.headers.get("x-relay-origin-status")).toBe("200");
  });

  test("error responses are always application/json, never HTML", async () => {
    const response = await handleFeedRequest(
      new Request(`${DEPLOYMENT_ORIGIN}/api/feed`, { headers: { Origin: DEPLOYMENT_ORIGIN } }),
    );
    expect(response.headers.get("content-type")).toContain("application/json");
  });
});
