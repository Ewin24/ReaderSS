/**
 * Worker entrypoint and route table ("/api/* first, else
 * env.ASSETS"; wrangler.toml's `run_worker_first = ["/api/*"]` sends every
 * /api/* request here before any static-asset fallback). `/api/health` is
 * not built yet — an unmatched /api/* path returns its
 * own 404 rather than falling through to env.ASSETS, so an unimplemented
 * API route never resolves to the app shell's HTML.
 */
import { applySecurityHeaders } from "./headers/security";
import { handleFeedRequest, buildUnhandledRelayErrorResponse } from "./routes/feed";

interface AssetsBinding {
  fetch(request: Request): Promise<Response>;
}

interface Env {
  ASSETS: AssetsBinding;
}

function notFound(): Response {
  return new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "no route for this path" } }), {
    status: 404,
    headers: { "Content-Type": "application/json" },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname.startsWith("/api/")) {
      if (pathname === "/api/feed" && request.method === "GET") {
        // Defense-in-depth: handleFeedRequest
        // maps every error it anticipates to the JSON taxonomy internally, so
        // this catch should never fire in practice. It exists so a future
        // code path this route table cannot anticipate still returns the
        // documented JSON contract instead of an unhandled exception.
        try {
          return applySecurityHeaders(await handleFeedRequest(request));
        } catch (error) {
          return applySecurityHeaders(buildUnhandledRelayErrorResponse(request, error));
        }
      }
      return applySecurityHeaders(notFound());
    }

    const response = await env.ASSETS.fetch(request);
    return applySecurityHeaders(response);
  },
};
