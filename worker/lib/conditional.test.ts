import { describe, expect, test } from "vitest";
import {
  buildOriginRequestHeaders,
  copyConditionalValidators,
  buildNotModifiedResponse,
} from "./conditional";

describe("buildOriginRequestHeaders", () => {
  test("forwards If-None-Match verbatim to the origin request", () => {
    const client = new Request("https://readerss.example/api/feed?url=https://blog.example.com/feed.xml", {
      headers: { "If-None-Match": '"abc"' },
    });
    const headers = buildOriginRequestHeaders(client);
    expect(headers.get("if-none-match")).toBe('"abc"');
  });

  test("forwards If-Modified-Since verbatim to the origin request", () => {
    const client = new Request("https://readerss.example/api/feed?url=https://blog.example.com/feed.xml", {
      headers: { "If-Modified-Since": "Wed, 21 Oct 2015 07:28:00 GMT" },
    });
    const headers = buildOriginRequestHeaders(client);
    expect(headers.get("if-modified-since")).toBe("Wed, 21 Oct 2015 07:28:00 GMT");
  });

  test("omits both conditional headers when the client sent neither", () => {
    const client = new Request("https://readerss.example/api/feed?url=https://blog.example.com/feed.xml");
    const headers = buildOriginRequestHeaders(client);
    expect(headers.has("if-none-match")).toBe(false);
    expect(headers.has("if-modified-since")).toBe(false);
  });

  test("always sets a fixed Accept and User-Agent regardless of client headers", () => {
    const client = new Request("https://readerss.example/api/feed?url=https://blog.example.com/feed.xml");
    const headers = buildOriginRequestHeaders(client);
    expect(headers.get("accept")).toContain("application/rss+xml");
    expect(headers.get("user-agent")).toBe("ReaderSS/1.0 (+relay)");
  });
});

describe("copyConditionalValidators", () => {
  test("copies ETag and Last-Modified from an origin response onto the target headers", () => {
    const origin = new Response(null, {
      headers: { ETag: '"xyz"', "Last-Modified": "Wed, 21 Oct 2015 07:28:00 GMT" },
    });
    const out = new Headers();
    copyConditionalValidators(origin, out);
    expect(out.get("etag")).toBe('"xyz"');
    expect(out.get("last-modified")).toBe("Wed, 21 Oct 2015 07:28:00 GMT");
  });

  test("copies nothing when the origin sent no validators", () => {
    const origin = new Response(null);
    const out = new Headers();
    copyConditionalValidators(origin, out);
    expect(out.has("etag")).toBe(false);
    expect(out.has("last-modified")).toBe(false);
  });
});

describe("buildNotModifiedResponse", () => {
  test("returns a 304 with an empty body", async () => {
    const origin = new Response(null, { status: 304, headers: { ETag: '"abc"' } });
    const response = buildNotModifiedResponse(origin);
    expect(response.status).toBe(304);
    expect(await response.text()).toBe("");
  });

  test("echoes ETag and Last-Modified from the origin", () => {
    const origin = new Response(null, {
      status: 304,
      headers: { ETag: '"abc"', "Last-Modified": "Wed, 21 Oct 2015 07:28:00 GMT" },
    });
    const response = buildNotModifiedResponse(origin);
    expect(response.headers.get("etag")).toBe('"abc"');
    expect(response.headers.get("last-modified")).toBe("Wed, 21 Oct 2015 07:28:00 GMT");
  });

  test("sets X-Relay-Origin-Status: 304 for client diagnostics", () => {
    const origin = new Response(null, { status: 304 });
    const response = buildNotModifiedResponse(origin);
    expect(response.headers.get("x-relay-origin-status")).toBe("304");
  });
});
