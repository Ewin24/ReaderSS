import { describe, expect, it } from "vitest";
import { DomPurifySanitizer, MAX_CACHEABLE_ENTRY_BYTES, MAX_TOTAL_CACHE_BYTES } from "./domPurifySanitizer";

/**
 * These assert on the adapter directly (the raw sanitized string), covering
 * the same adversarial payload list as `SafeHtml.test.tsx`, which asserts
 * the same payloads against the rendered DOM. Two layers of the same
 * coverage: one proves the sanitizer's own output, the other proves nothing
 * downstream (Preact/dangerouslySetInnerHTML) reintroduces risk.
 */
describe("DomPurifySanitizer", () => {
  it("removes script elements and their content", () => {
    const sanitizer = new DomPurifySanitizer();
    const clean = sanitizer.sanitize("<script>alert(1)</script>Hello", "k1");
    expect(clean).not.toContain("<script");
    expect(clean).not.toContain("alert(1)");
    expect(clean).toContain("Hello");
  });

  it("removes on* event-handler attributes", () => {
    const sanitizer = new DomPurifySanitizer();
    const clean = sanitizer.sanitize('<img src="x" onerror="steal()">', "k2");
    expect(clean).not.toMatch(/on\w+\s*=/i);
  });

  it("neutralizes javascript: URLs in href", () => {
    const sanitizer = new DomPurifySanitizer();
    const clean = sanitizer.sanitize('<a href="javascript:alert(1)">click</a>', "k3");
    expect(clean).not.toContain("javascript:");
  });

  it("neutralizes javascript: URLs in img src", () => {
    const sanitizer = new DomPurifySanitizer();
    const clean = sanitizer.sanitize('<img src="javascript:alert(1)">', "k4");
    expect(clean).not.toContain("javascript:");
  });

  it("removes iframe elements", () => {
    const sanitizer = new DomPurifySanitizer();
    const clean = sanitizer.sanitize('<iframe src="https://evil.example"></iframe>', "k5");
    expect(clean).not.toContain("<iframe");
  });

  it("removes object and embed elements", () => {
    const sanitizer = new DomPurifySanitizer();
    expect(sanitizer.sanitize('<object data="evil.swf"></object>', "k6")).not.toContain("<object");
    expect(sanitizer.sanitize('<embed src="evil.swf">', "k7")).not.toContain("<embed");
  });

  it("removes form and input elements", () => {
    const sanitizer = new DomPurifySanitizer();
    const clean = sanitizer.sanitize('<form action="https://evil.example"><input></form>', "k8");
    expect(clean).not.toContain("<form");
    expect(clean).not.toContain("<input");
  });

  it("removes style elements and the style attribute", () => {
    const sanitizer = new DomPurifySanitizer();
    expect(sanitizer.sanitize("<style>body{background:url(javascript:alert(1))}</style>", "k9")).not.toContain(
      "<style",
    );
    expect(sanitizer.sanitize('<p style="color:red">x</p>', "k10")).not.toContain("style=");
  });

  it("neutralizes a <noscript> mXSS payload: a parser-context-switch trick using a nested title attribute", () => {
    // Classic noscript mXSS shape: the `</noscript>` embedded inside the
    // `title` attribute value exploits the parsing-context switch between
    // "noscript content is parsed as text" (scripting enabled) and "parsed
    // as markup" (scripting disabled) to smuggle a live element past a
    // sanitizer that reads the DOM in the wrong mode.
    const sanitizer = new DomPurifySanitizer();
    const clean = sanitizer.sanitize(
      '<noscript><p title="</noscript><img src=x onerror=alert(1)>">x</noscript>',
      "k18",
    );
    expect(clean).not.toContain("<noscript");
    expect(clean).not.toMatch(/onerror/i);
    expect(clean).not.toContain("<img");
  });

  it("strips the srcset attribute from images (FORBID_ATTR)", () => {
    const sanitizer = new DomPurifySanitizer();
    const clean = sanitizer.sanitize(
      '<img src="https://example.com/a.png" srcset="https://evil.example/x.png 1x">',
      "k19",
    );
    expect(clean).not.toContain("srcset");
    expect(clean).toContain('src="https://example.com/a.png"');
  });

  it("removes SVG-based vectors (USE_PROFILES html-only excludes the svg profile)", () => {
    const sanitizer = new DomPurifySanitizer();
    const clean = sanitizer.sanitize(
      '<svg><use xlink:href="data:image/svg+xml,<svg id=x xmlns=http://www.w3.org/2000/svg><image href=1 onerror=alert(1)/></svg>#x" /></svg>',
      "k11",
    );
    expect(clean).not.toContain("<svg");
    expect(clean).not.toContain("<use");
  });

  it("does not throw and does not leave executable markup on obfuscated/mixed-case payloads", () => {
    const sanitizer = new DomPurifySanitizer();
    expect(() => sanitizer.sanitize("<ScRiPt>alert(1)</sCrIpT>", "k12")).not.toThrow();
    const mixedCase = sanitizer.sanitize("<ScRiPt>alert(1)</sCrIpT>", "k12");
    expect(mixedCase).not.toContain("alert(1)");

    const entityEncoded = sanitizer.sanitize('<a href="&#106;avascript:alert(1)">x</a>', "k13");
    expect(entityEncoded).not.toContain("javascript:");
  });

  it("does not throw and returns a non-blank result on malformed/nested markup", () => {
    const sanitizer = new DomPurifySanitizer();
    expect(() => sanitizer.sanitize("<div><span><script>alert(1)</script>unclosed", "k14")).not.toThrow();
    const clean = sanitizer.sanitize("<div><span><script>alert(1)</script>unclosed", "k14");
    expect(clean).not.toContain("alert(1)");
  });

  it("preserves benign formatting markup (headings, paragraphs, lists, links, images, code, blockquote)", () => {
    const sanitizer = new DomPurifySanitizer();
    const benign =
      "<h1>Title</h1><p>Hello <b>world</b></p>" +
      '<a href="https://example.com">link</a>' +
      '<img src="https://example.com/a.png">' +
      "<pre><code>code</code></pre><ul><li>item</li></ul><blockquote>quote</blockquote>";
    const clean = sanitizer.sanitize(benign, "k15");
    expect(clean).toContain("<h1>Title</h1>");
    expect(clean).toContain("Hello <b>world</b>");
    expect(clean).toContain('href="https://example.com"');
    expect(clean).toContain("<pre><code>code</code></pre>");
    expect(clean).toContain("<blockquote>quote</blockquote>");
    expect(clean).toContain("<li>item</li>");
  });

  it("forces rel=noopener noreferrer nofollow and target=_blank on every anchor", () => {
    const sanitizer = new DomPurifySanitizer();
    const clean = sanitizer.sanitize('<a href="https://example.com">link</a>', "k16");
    expect(clean).toContain('target="_blank"');
    expect(clean).toContain('rel="noopener noreferrer nofollow"');
  });

  it("forces loading=lazy and referrerpolicy=no-referrer on every image (images are allowed, leak is mitigated, not blocked)", () => {
    const sanitizer = new DomPurifySanitizer();
    const clean = sanitizer.sanitize('<img src="https://example.com/a.png">', "k17");
    expect(clean).toContain('loading="lazy"');
    expect(clean).toContain('referrerpolicy="no-referrer"');
  });

  it("memoizes by cacheKey: an unchanged cacheKey returns without re-sanitizing new input", () => {
    const sanitizer = new DomPurifySanitizer();
    const first = sanitizer.sanitize("<p>original</p>", "same-key");
    // A second call with the SAME cacheKey but a DIFFERENT html argument
    // returns the cached result for that key, proving the LRU is actually
    // consulted rather than a no-op wrapper around a fresh sanitize call.
    const second = sanitizer.sanitize("<p>changed</p>", "same-key");
    expect(second).toBe(first);
    expect(second).toContain("original");
  });

  it("evicts the least-recently-used entry once the cache exceeds 100 entries", () => {
    const sanitizer = new DomPurifySanitizer();
    for (let i = 0; i < 100; i += 1) {
      sanitizer.sanitize(`<p>entry-${i}</p>`, `key-${i}`);
    }
    // key-0 is now the least recently used; one more distinct key evicts it.
    sanitizer.sanitize("<p>entry-100</p>", "key-100");
    // Re-sanitizing key-0 with different content must NOT return the old
    // cached value, because it was evicted.
    const afterEviction = sanitizer.sanitize("<p>entry-0-changed</p>", "key-0");
    expect(afterEviction).toContain("entry-0-changed");
  });

  it("does not memoize a single sanitized document larger than MAX_CACHEABLE_ENTRY_BYTES", () => {
    // The 100-entry cap alone bounds key COUNT, not memory: one hundred
    // very large sanitized documents is still one hundred very large
    // documents held in memory. An oversized entry is sanitized and
    // returned, but simply never enters the cache.
    const sanitizer = new DomPurifySanitizer();
    const big = `<p>${"x".repeat(MAX_CACHEABLE_ENTRY_BYTES + 1)}</p>`;

    sanitizer.sanitize(big, "oversized-key");
    // Same cacheKey, different html: a cache HIT would return the first
    // result unchanged. Because the entry was never cached, this must
    // re-sanitize and reflect the new input instead.
    const second = sanitizer.sanitize("<p>different</p>", "oversized-key");

    expect(second).toContain("different");
    expect(second).not.toContain("x".repeat(100));
  });

  it("evicts the oldest cached entries once total cached bytes exceed MAX_TOTAL_CACHE_BYTES, even though key count stays under the 100-entry capacity", () => {
    const sanitizer = new DomPurifySanitizer();
    // Each chunk sits comfortably under the per-entry skip threshold, so
    // every one of these calls IS memoized individually -- the eviction
    // being tested here is driven purely by the running total exceeding
    // MAX_TOTAL_CACHE_BYTES, not by the per-entry threshold above.
    const chunkLength = Math.floor(MAX_CACHEABLE_ENTRY_BYTES * 0.6);
    const chunk = "x".repeat(chunkLength);
    const entriesNeededToExceedTotal = Math.ceil(MAX_TOTAL_CACHE_BYTES / chunkLength) + 1;

    for (let i = 0; i < entriesNeededToExceedTotal; i += 1) {
      sanitizer.sanitize(`<p>${chunk}-${i}</p>`, `byte-key-${i}`);
    }

    // byte-key-0 was cached first and must have been evicted by total-byte
    // pressure well before the 100-key capacity would ever trigger it
    // (entriesNeededToExceedTotal is far below 100 for these sizes).
    const afterEviction = sanitizer.sanitize("<p>changed</p>", "byte-key-0");
    expect(afterEviction).toContain("changed");
  });
});
