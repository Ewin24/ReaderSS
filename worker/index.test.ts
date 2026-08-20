import { afterEach, describe, expect, test, vi, type Mock } from "vitest";
import worker from "./index";
import { handleFeedRequest } from "./routes/feed";

vi.mock("./routes/feed", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./routes/feed")>();
  // Wraps the real implementation so every existing test keeps exercising
  // genuine relay behavior; only the defense-in-depth test below overrides
  // it, once, via mockRejectedValueOnce.
  return { ...actual, handleFeedRequest: vi.fn(actual.handleFeedRequest) };
});

interface AssetsBinding {
  fetch(request: Request): Promise<Response>;
}
interface Env {
  ASSETS: AssetsBinding;
}

function makeEnv(assetsResponse: Response): Env {
  return { ASSETS: { fetch: vi.fn(async () => assetsResponse) } };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("worker route table", () => {
  test("routes GET /api/feed to the feed relay handler", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response("<rss></rss>", { status: 200, headers: { "Content-Type": "application/rss+xml" } }),
      ),
    );
    const request = new Request("https://readerss.example/api/feed?url=https://blog.example.com/feed.xml", {
      headers: { "Sec-Fetch-Site": "same-origin" },
    });
    const env = makeEnv(new Response("should not be used"));

    const response = await worker.fetch(request, env);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("<rss></rss>");
    expect(env.ASSETS.fetch).not.toHaveBeenCalled();
  });

  test("returns 404 JSON for an unmatched /api/* path, without falling through to ASSETS", async () => {
    const request = new Request("https://readerss.example/api/does-not-exist");
    const env = makeEnv(new Response("should not be used"));

    const response = await worker.fetch(request, env);

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(env.ASSETS.fetch).not.toHaveBeenCalled();
  });

  test("falls through to env.ASSETS for a non-/api/ path, with security headers applied", async () => {
    const request = new Request("https://readerss.example/index.html");
    const env = makeEnv(new Response("<html></html>", { status: 200, headers: { "Content-Type": "text/html" } }));

    const response = await worker.fetch(request, env);

    expect(env.ASSETS.fetch).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  /**
   * The route boundary's defense-in-depth catch. The per-hop
   * try/catch inside `handleFeedRequest` (worker/routes/feed.ts) is expected
   * to map every error it can encounter to the JSON taxonomy, so this route
   * boundary catch should never fire in practice against real code — this
   * test proves it exists and works for any future code path that escapes
   * that inner catch anyway, rather than turning into an unhandled exception
   * / opaque platform error page.
   */
  test("wraps an unexpected throw from handleFeedRequest in the taxonomy-conformant JSON error contract, not an unhandled exception", async () => {
    (handleFeedRequest as unknown as Mock).mockRejectedValueOnce(new Error("boom"));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const request = new Request("https://readerss.example/api/feed?url=https://blog.example.com/feed.xml", {
      headers: { "Sec-Fetch-Site": "same-origin" },
    });
    const env = makeEnv(new Response("should not be used"));

    const response = await worker.fetch(request, env);

    expect(response.status).toBe(502);
    expect(response.headers.get("content-type")).toContain("application/json");
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("UPSTREAM_ERROR");
    // The error must be logged, never swallowed silently.
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});
