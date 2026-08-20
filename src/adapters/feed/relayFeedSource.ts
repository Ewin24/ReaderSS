import type {
  FeedFetchErrorCode,
  FeedFetchResult,
  FeedFetchValidators,
  FeedSourcePort,
} from "../../ports/FeedSourcePort";
import { FEED_FETCH_ERROR_CODES } from "../../ports/FeedSourcePort";

const RELAY_ENDPOINT = "/api/feed";

/**
 * Every response `worker/routes/feed.ts` produces (success via
 * `readLimitedBody`, or a 304 via `buildNotModifiedResponse` in
 * `worker/lib/conditional.ts`) sets this header. An error response
 * (`errorResponse()` in `worker/routes/feed.ts`) does not set it, but is
 * still identifiable by its own `application/json` body matching the
 * `RELAY_ERROR_CODES` taxonomy — checked separately by `parseRelayError`.
 * Its absence on a 2xx/304 response, or an HTML body regardless of status,
 * means whatever answered `/api/feed` was not the relay at all: found by
 * real use, this happens when the dev server has no Worker wired in and its
 * own SPA fallback answers `/api/feed` with `index.html` and a 200.
 */
const RELAY_MARKER_HEADER = "X-Relay-Origin-Status";

function isHtmlContentType(contentType: string | null): boolean {
  if (contentType === null) return false;
  return contentType.split(";")[0].trim().toLowerCase() === "text/html";
}

/** True when `response` carries none of the marks a real relay response
 * always has on a non-error path (see RELAY_MARKER_HEADER's doc comment). */
function looksLikeMissingRelay(response: Response): boolean {
  return response.headers.get(RELAY_MARKER_HEADER) === null || isHtmlContentType(response.headers.get("Content-Type"));
}

function relayUnavailableResult(): { status: "error"; code: "RELAY_UNAVAILABLE"; message: string } {
  return {
    status: "error",
    code: "RELAY_UNAVAILABLE",
    message:
      "The app's feed relay did not respond -- this is a local setup problem, not an issue with the feed you entered. " +
      "If you are developing locally, make sure your dev command starts the relay (see README.md); if this happens in " +
      "a deployed app, the deployment is misconfigured.",
  };
}

/**
 * The Worker's own cumulative deadline
 * (worker/routes/feed.ts's UPSTREAM_TIMEOUT_MS) bounds total relay-to-origin
 * latency to 10s regardless of redirect count. This
 * client-side budget is set slightly ABOVE that bound -- 2s of slack for the
 * relay's own request/response processing, TLS handshake, and network
 * round-trip -- so a hung or unreachable relay fails the client visibly
 * instead of hanging on the browser's own generic, much longer timeout.
 */
const CLIENT_TIMEOUT_MS = 12_000;

function isKnownErrorCode(value: unknown): value is FeedFetchErrorCode {
  return typeof value === "string" && (FEED_FETCH_ERROR_CODES as readonly string[]).includes(value);
}

async function parseRelayError(response: Response): Promise<{ code: FeedFetchErrorCode; message: string }> {
  try {
    const parsed = (await response.json()) as { error?: { code?: unknown; message?: unknown } };
    if (isKnownErrorCode(parsed.error?.code)) {
      const message = typeof parsed.error?.message === "string" ? parsed.error.message : `relay returned ${response.status}`;
      return { code: parsed.error.code, message };
    }
  } catch {
    // The relay's contract (worker/routes/feed.ts) always returns this JSON
    // shape on error, but a client parser stays defensive against anything
    // unexpected in front of it (an intermediate proxy, a Cloudflare error
    // page) rather than throwing.
  }
  return {
    code: "UPSTREAM_ERROR",
    message: `relay returned an unrecognized error (status ${response.status})`,
  };
}

/**
 * Client-side implementation of FeedSourcePort: calls the Worker relay at
 * `/api/feed` (design.md §2). The relay is same-origin, so this is a plain
 * same-origin fetch — no separate base URL configuration. The fetch carries
 * its own bounded `AbortSignal.timeout(CLIENT_TIMEOUT_MS)`, distinct from
 * (and slightly larger than) the relay's own server-side deadline, so a hung
 * relay produces a specific `CLIENT_TIMEOUT` result rather than leaving the
 * caller waiting indefinitely.
 */
export class RelayFeedSource implements FeedSourcePort {
  async fetchFeed(url: string, validators: FeedFetchValidators): Promise<FeedFetchResult> {
    const headers = new Headers();
    if (validators.etag !== null) headers.set("If-None-Match", validators.etag);
    if (validators.lastModified !== null) headers.set("If-Modified-Since", validators.lastModified);

    let response: Response;
    try {
      response = await fetch(`${RELAY_ENDPOINT}?url=${encodeURIComponent(url)}`, {
        headers,
        signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS),
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "TimeoutError") {
        return {
          status: "error",
          code: "CLIENT_TIMEOUT",
          message: `the relay did not respond within ${CLIENT_TIMEOUT_MS / 1000}s`,
        };
      }
      return { status: "error", code: "NETWORK_ERROR", message: "the relay could not be reached" };
    }

    if (response.status === 304) {
      if (looksLikeMissingRelay(response)) {
        return relayUnavailableResult();
      }
      return { status: "not-modified" };
    }

    if (!response.ok) {
      // Only the HTML check applies here, not the marker-header check: a
      // genuine relay error response (`errorResponse()` in
      // worker/routes/feed.ts) correctly omits RELAY_MARKER_HEADER, so
      // requiring it on this path would misclassify every real relay error
      // as "relay missing".
      if (isHtmlContentType(response.headers.get("Content-Type"))) {
        return relayUnavailableResult();
      }
      const { code, message } = await parseRelayError(response);
      return { status: "error", code, message };
    }

    if (looksLikeMissingRelay(response)) {
      return relayUnavailableResult();
    }

    const body = await response.text();
    return {
      status: "updated",
      body,
      contentType: response.headers.get("Content-Type") ?? "",
      etag: response.headers.get("ETag"),
      lastModified: response.headers.get("Last-Modified"),
    };
  }
}
