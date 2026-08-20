import { describe, expect, test } from "vitest";
import { validateOrigin } from "./originGuard";

const DEPLOYMENT_URL = "https://readerss.example.workers.dev/api/feed?url=https://blog.example.com/feed.xml";
const DEPLOYMENT_ORIGIN = "https://readerss.example.workers.dev";

function makeRequest(headers: Record<string, string>): Request {
  return new Request(DEPLOYMENT_URL, { headers });
}

describe("validateOrigin — Origin header present", () => {
  test("allows an Origin equal to the deployment origin", () => {
    const result = validateOrigin(makeRequest({ Origin: DEPLOYMENT_ORIGIN }));
    expect(result.allowed).toBe(true);
  });

  test("rejects a foreign Origin", () => {
    const result = validateOrigin(makeRequest({ Origin: "https://evil.example" }));
    expect(result.allowed).toBe(false);
  });

  /**
   * MANDATORY: a spoofed Origin identical to the
   * deployment origin still passes this check. `curl -H "Origin: <url>"`
   * can set this header to anything. Origin/Referer/Sec-Fetch-* are
   * enforced by browsers, not by the server receiving them — this guard
   * raises the cost of casual browser-based abuse (a page on another site
   * cannot make the browser lie about Origin), it does NOT authenticate the
   * caller. Anyone who reads the client source and issues a raw HTTP
   * request can set this header to whatever passes.
   */
  test("a curl-style request with a hand-set Origin equal to the deployment origin passes — this is NOT authentication", () => {
    const request = new Request(DEPLOYMENT_URL, {
      headers: { Origin: DEPLOYMENT_ORIGIN },
      // No Sec-Fetch-* headers at all: real browsers always attach these
      // automatically and JS cannot override them, but curl/fetch-from-a-
      // script send exactly what the caller asks for — nothing here
      // distinguishes a browser tab from a scripted client.
    });
    const result = validateOrigin(request);
    expect(result.allowed).toBe(true);
  });
});

describe("validateOrigin — Origin header absent", () => {
  test("allows a missing Origin when Sec-Fetch-Site: same-origin is present", () => {
    const result = validateOrigin(makeRequest({ "Sec-Fetch-Site": "same-origin" }));
    expect(result.allowed).toBe(true);
  });

  test("rejects a missing Origin with no Sec-Fetch-Site and no Referer", () => {
    const result = validateOrigin(makeRequest({}));
    expect(result.allowed).toBe(false);
  });

  test("rejects a missing Origin with Sec-Fetch-Site: cross-site", () => {
    const result = validateOrigin(makeRequest({ "Sec-Fetch-Site": "cross-site" }));
    expect(result.allowed).toBe(false);
  });

  test("rejects a missing Origin with a foreign Referer", () => {
    const result = validateOrigin(makeRequest({ Referer: "https://evil.example/attack.html" }));
    expect(result.allowed).toBe(false);
  });

  test("rejects a missing Origin with a malformed Referer", () => {
    const result = validateOrigin(makeRequest({ Referer: "not a url" }));
    expect(result.allowed).toBe(false);
  });

  /**
   * Documents the same non-authentication limitation for the Referer
   * fallback path: a forged Referer matching the deployment origin, with
   * no browser-enforced Sec-Fetch-Site present, still passes.
   */
  test("a spoofed Referer equal to the deployment origin passes when Origin is absent — again, NOT authentication", () => {
    const result = validateOrigin(makeRequest({ Referer: `${DEPLOYMENT_ORIGIN}/index.html` }));
    expect(result.allowed).toBe(true);
  });
});
