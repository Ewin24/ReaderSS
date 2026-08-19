/**
 * The feed relay route (design.md §2 "The Relay Contract"). `GET
 * /api/feed?url=<percent-encoded absolute http(s) URL>`.
 *
 * Order of checks: caller origin, then URL parseability, then the SSRF
 * guard (re-applied on every redirect hop), then content-type, then the
 * streamed size cap. Every rejection this function can produce, INCLUDING
 * one thrown mid-hop (a fetch-level abort, a mid-stream body-read abort per
 * the WHATWG Fetch spec — aborting a fetch's controller also errors its
 * response body stream, not just the header-wait phase — or a malformed
 * redirect `Location` header from the origin), is caught by the per-hop
 * try/catch below and mapped to design.md §2's error-code table. The result
 * is always `application/json`, never HTML, so the client can always parse
 * the response. `worker/index.ts`'s route boundary carries a second,
 * defense-in-depth catch (`buildUnhandledRelayErrorResponse`) for any future
 * code path this file's own catch does not anticipate, so the JSON contract
 * cannot silently break even if this file is edited incorrectly later.
 */
import { validateOrigin } from "../guards/originGuard";
import { validateTargetUrl } from "../guards/targetUrlGuard";
import { buildOriginRequestHeaders, copyConditionalValidators, buildNotModifiedResponse } from "../lib/conditional";
import { readLimitedBody, MAX_BODY_BYTES, PayloadTooLargeError } from "../lib/limitedBody";
import type { RelayErrorCode } from "../../shared/feedErrorCodes";

const UPSTREAM_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

// design.md §2 "Limits" table — media type only, parameters (e.g. charset) ignored.
const ALLOWED_CONTENT_TYPES = new Set([
  "application/rss+xml",
  "application/atom+xml",
  "application/xml",
  "text/xml",
  "application/rdf+xml",
  "application/json",
  "application/feed+json",
  "text/json",
  "text/plain",
]);

function errorResponse(
  deploymentOrigin: string,
  status: number,
  code: RelayErrorCode,
  message: string,
  targetHost: string | null = null,
  upstreamStatus: number | null = null,
): Response {
  const body = { error: { code, message, targetHost, upstreamStatus } };
  const headers = new Headers({ "Content-Type": "application/json" });
  applyCors(headers, deploymentOrigin);
  return new Response(JSON.stringify(body), { status, headers });
}

function applyCors(headers: Headers, deploymentOrigin: string): void {
  // design.md §2 "relay → client" row: the exact app origin, never "*".
  headers.set("Access-Control-Allow-Origin", deploymentOrigin);
  headers.set("Vary", "Origin");
}

function extractMediaType(contentType: string | null): string | null {
  if (contentType === null) return null;
  return contentType.split(";")[0].trim().toLowerCase();
}

/**
 * Creates the ONE deadline signal for a whole client request (Slice 4
 * correction, finding 3). Previously `AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)`
 * was created fresh inside the per-hop loop, so a 3-hop redirect chain could
 * consume up to ~3x the advertised budget while every individual hop stayed
 * "well behaved" under its own fresh timer. Creating this once, before the
 * loop, and reusing the same signal on every hop's `fetch` call bounds total
 * relay latency to `UPSTREAM_TIMEOUT_MS` regardless of redirect count. A
 * plain `AbortController` + `setTimeout` is used instead of the static
 * `AbortSignal.timeout()` helper so the deadline is driven by ordinary,
 * fake-timer-controllable timers in tests.
 */
function createDeadlineSignal(timeoutMs: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => {
    controller.abort(new DOMException(`relay exceeded its ${timeoutMs / 1000}s budget`, "TimeoutError"));
  }, timeoutMs);
  return controller.signal;
}

export async function handleFeedRequest(request: Request): Promise<Response> {
  const deploymentOrigin = new URL(request.url).origin;

  const originCheck = validateOrigin(request);
  if (!originCheck.allowed) {
    return errorResponse(deploymentOrigin, 403, "FORBIDDEN_ORIGIN", originCheck.detail);
  }

  const rawUrl = new URL(request.url).searchParams.get("url");
  if (rawUrl === null) {
    return errorResponse(deploymentOrigin, 400, "INVALID_URL", 'missing required "url" query parameter');
  }

  let currentUrl = rawUrl;
  let redirectCount = 0;
  let targetHost: string;
  // One cumulative deadline for the whole request — see createDeadlineSignal.
  const deadlineSignal = createDeadlineSignal(UPSTREAM_TIMEOUT_MS);

  while (true) {
    const guardResult = validateTargetUrl(currentUrl);
    if (!guardResult.allowed) {
      const isMalformedRequest =
        guardResult.reason === "unparseable" || guardResult.reason === "unsupported_scheme";
      // Reports the hop that was ACTUALLY rejected (finding 6) — not a
      // previously-validated hop's hostname, which would mislead anyone
      // triaging an SSRF attempt on a multi-hop redirect chain.
      return errorResponse(
        deploymentOrigin,
        isMalformedRequest ? 400 : 403,
        isMalformedRequest ? "INVALID_URL" : "BLOCKED_TARGET",
        guardResult.detail,
        guardResult.hostname,
      );
    }

    targetHost = guardResult.url.hostname;

    try {
      const upstream = await fetch(guardResult.url.toString(), {
        method: "GET",
        headers: buildOriginRequestHeaders(request),
        redirect: "manual",
        signal: deadlineSignal,
      });

      if (upstream.status === 304) {
        const notModified = buildNotModifiedResponse(upstream);
        applyCors(notModified.headers, deploymentOrigin);
        return notModified;
      }

      if (upstream.status >= 300 && upstream.status < 400) {
        const location = upstream.headers.get("Location");
        if (location === null) {
          return errorResponse(
            deploymentOrigin,
            502,
            "UPSTREAM_ERROR",
            `${targetHost} sent a redirect with no Location header`,
            targetHost,
            upstream.status,
          );
        }
        if (redirectCount >= MAX_REDIRECTS) {
          return errorResponse(
            deploymentOrigin,
            502,
            "TOO_MANY_REDIRECTS",
            `${targetHost} exceeded the ${MAX_REDIRECTS}-hop redirect limit`,
            targetHost,
          );
        }
        redirectCount += 1;
        // `new URL(location, ...)` throws on a malformed Location (finding 1,
        // path B) — caught below and mapped to UPSTREAM_ERROR, since a
        // malformed redirect is the ORIGIN misbehaving, not the caller.
        currentUrl = new URL(location, guardResult.url).toString();
        continue;
      }

      if (upstream.status < 200 || upstream.status >= 300) {
        return errorResponse(
          deploymentOrigin,
          502,
          "UPSTREAM_ERROR",
          `${targetHost} responded with ${upstream.status}`,
          targetHost,
          upstream.status,
        );
      }

      const mediaType = extractMediaType(upstream.headers.get("Content-Type"));
      if (mediaType === null || !ALLOWED_CONTENT_TYPES.has(mediaType)) {
        return errorResponse(
          deploymentOrigin,
          415,
          "UNSUPPORTED_CONTENT_TYPE",
          `content type "${upstream.headers.get("Content-Type") ?? "(none)"}" is not a supported feed format`,
          targetHost,
        );
      }

      // `readLimitedBody` can also reject with the deadline's TimeoutError
      // (finding 1, path A): per the WHATWG Fetch spec, aborting a fetch's
      // controller errors its response body stream too, not just the
      // header-wait phase, so a slow-trickling body under the 5 MiB cap can
      // still trip the deadline here rather than at the `fetch()` call.
      const body = await readLimitedBody(upstream, MAX_BODY_BYTES);

      const headers = new Headers({
        "Content-Type": upstream.headers.get("Content-Type") ?? mediaType,
        "X-Relay-Origin-Status": String(upstream.status),
        "Cache-Control": "no-cache",
      });
      copyConditionalValidators(upstream, headers);
      applyCors(headers, deploymentOrigin);

      return new Response(body, { status: 200, headers });
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        return errorResponse(deploymentOrigin, 413, "PAYLOAD_TOO_LARGE", error.message, targetHost);
      }
      if (error instanceof DOMException && error.name === "TimeoutError") {
        return errorResponse(
          deploymentOrigin,
          504,
          "UPSTREAM_TIMEOUT",
          `${targetHost} did not respond within ${UPSTREAM_TIMEOUT_MS / 1000}s`,
          targetHost,
        );
      }
      // ANY other thrown error (a network-level fetch rejection, a malformed
      // redirect Location, or anything this route did not anticipate) maps
      // to the generic upstream-failure code rather than escaping as an
      // unhandled exception — the whole point of this correction round.
      return errorResponse(deploymentOrigin, 502, "UPSTREAM_ERROR", `could not reach ${targetHost}`, targetHost);
    }
  }
}

/**
 * Defense-in-depth for `worker/index.ts`'s route boundary (finding 1). The
 * per-hop try/catch inside `handleFeedRequest` above is expected to map
 * every error it can encounter to the JSON taxonomy, so this should never
 * fire in practice — it exists so that a future code path added to this
 * route that the try/catch above does not anticipate still returns the
 * documented contract instead of an unhandled exception turning into an
 * opaque HTML/platform error page that defeats `relayFeedSource.ts`'s
 * `parseRelayError`. The error is logged, never swallowed silently.
 */
export function buildUnhandledRelayErrorResponse(request: Request, error: unknown): Response {
  const deploymentOrigin = new URL(request.url).origin;
  // Workers logs (wrangler tail / dashboard) are this route's only
  // observability channel; the error must not vanish.
  console.error("unhandled error in feed relay route", error);
  return errorResponse(
    deploymentOrigin,
    502,
    "UPSTREAM_ERROR",
    "the relay encountered an unexpected internal error",
  );
}
