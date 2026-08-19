/**
 * Caller-origin check for the feed relay (design.md §2). `Origin` (falling
 * back to `Referer`) must equal the Worker's own deployment origin, taken
 * from the incoming request's own URL — the app and the API are served
 * from the same origin (design.md "Technical Approach"), so there is no
 * separately configured allow-list to keep in sync.
 *
 * Stated plainly, because this is easy to over-trust: `Origin`, `Referer`,
 * and `Sec-Fetch-*` are set by the browser and cannot be scripted by a page
 * on another origin — but a raw HTTP client (curl, a server-side script)
 * can set every one of them to anything it wants. This check raises the
 * cost of casual browser-based abuse (a malicious page cannot make a
 * visitor's browser forge these headers); it is NOT authentication and
 * does not verify the caller's identity. See
 * worker/guards/originGuard.test.ts for the tests that encode this
 * limitation directly, and design.md §2's residual-risk table.
 */

export type OriginGuardResult =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly detail: string };

function originsMatch(candidate: string, deploymentOrigin: string): boolean {
  try {
    return new URL(candidate).origin === deploymentOrigin;
  } catch {
    return false;
  }
}

export function validateOrigin(request: Request): OriginGuardResult {
  const deploymentOrigin = new URL(request.url).origin;
  const origin = request.headers.get("Origin");

  if (origin !== null) {
    return origin === deploymentOrigin
      ? { allowed: true }
      : { allowed: false, detail: `Origin "${origin}" does not match deployment origin "${deploymentOrigin}"` };
  }

  // No Origin header: a same-origin GET fetch commonly omits it. Accept if
  // either signal available on a same-origin request confirms it — the
  // browser-set Sec-Fetch-Site header, or a Referer whose origin matches.
  if (request.headers.get("Sec-Fetch-Site") === "same-origin") {
    return { allowed: true };
  }

  const referer = request.headers.get("Referer");
  if (referer !== null && originsMatch(referer, deploymentOrigin)) {
    return { allowed: true };
  }

  return {
    allowed: false,
    detail: "missing Origin, and neither Sec-Fetch-Site nor Referer confirm the deployment origin",
  };
}
