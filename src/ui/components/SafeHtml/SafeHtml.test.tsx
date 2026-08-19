import { describe, expect, it } from "vitest";
import { render } from "@testing-library/preact";
import { DomPurifySanitizer } from "../../../adapters/security/domPurifySanitizer";
import { SafeHtml } from "./SafeHtml";
import { SanitizerContext } from "./SanitizerContext";

/**
 * Renders through the REAL `DomPurifySanitizer` (not a mock) so these
 * assertions prove the actual end-to-end behavior of the choke point --
 * `SafeHtml` calling into DOMPurify -- against the rendered DOM, per
 * design.md §7's testing strategy ("assert the resulting DOM, not the
 * string"). `domPurifySanitizer.test.ts` covers the same payload list
 * against the sanitizer's raw string output; this file covers the same list
 * one layer further downstream, through Preact's `dangerouslySetInnerHTML`.
 */
function renderSafeHtml(html: string, cacheKey = "test-key") {
  const sanitizer = new DomPurifySanitizer();
  const { container } = render(
    <SanitizerContext.Provider value={(h, k) => sanitizer.sanitize(h, k)}>
      <SafeHtml html={html} cacheKey={cacheKey} />
    </SanitizerContext.Provider>,
  );
  return container;
}

describe("SafeHtml", () => {
  it("renders no script element in the DOM and does not execute feed script content", () => {
    const container = renderSafeHtml("<script>window.__pwned = true;</script>Hello");
    expect(container.querySelector("script")).toBeNull();
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
    expect(container.textContent).toContain("Hello");
  });

  it("renders no on* attribute on any element", () => {
    const container = renderSafeHtml('<img src="x" onerror="window.__pwned = true">');
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("onerror")).toBeNull();
  });

  it("never retains a javascript: URL in href", () => {
    const container = renderSafeHtml('<a href="javascript:window.__pwned = true">click</a>');
    const anchor = container.querySelector("a");
    expect(anchor?.getAttribute("href")).not.toBe("javascript:window.__pwned = true");
    expect(anchor?.href ?? "").not.toContain("javascript:");
  });

  it("renders no iframe element", () => {
    const container = renderSafeHtml('<iframe src="https://evil.example"></iframe>');
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("renders no element and no onerror attribute from a <noscript> mXSS payload (Finding 5)", () => {
    const container = renderSafeHtml(
      '<noscript><p title="</noscript><img src=x onerror=window.__pwned = true>">x</noscript>',
    );
    expect(container.querySelector("noscript")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect((window as unknown as { __pwned?: boolean }).__pwned).toBeUndefined();
  });

  it("never renders a srcset attribute on an image (Finding 5)", () => {
    const container = renderSafeHtml(
      '<img src="https://example.com/a.png" srcset="https://evil.example/x.png 1x">',
    );
    const img = container.querySelector("img");
    expect(img?.getAttribute("srcset")).toBeNull();
  });

  it("does not throw and does not leave the pane blank on obfuscated/entity-encoded payloads", () => {
    expect(() => renderSafeHtml('<a href="&#106;avascript:alert(1)">x</a>')).not.toThrow();
    const container = renderSafeHtml("<ScRiPt>alert(1)</sCrIpT>Still readable");
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("Still readable");
  });

  it("preserves benign formatting markup in the rendered DOM", () => {
    const container = renderSafeHtml(
      "<h1>Title</h1><p>Hello <b>world</b></p><ul><li>item</li></ul><pre><code>code</code></pre>",
    );
    expect(container.querySelector("h1")?.textContent).toBe("Title");
    expect(container.querySelector("p b")?.textContent).toBe("world");
    expect(container.querySelector("li")?.textContent).toBe("item");
    expect(container.querySelector("pre code")?.textContent).toBe("code");
  });

  it("forces rel=noopener noreferrer nofollow on rendered outbound links (content-security spec)", () => {
    const container = renderSafeHtml('<a href="https://example.com">link</a>');
    const anchor = container.querySelector("a");
    expect(anchor?.getAttribute("rel")).toBe("noopener noreferrer nofollow");
    expect(anchor?.getAttribute("target")).toBe("_blank");
  });

  it("forces referrerpolicy=no-referrer and loading=lazy on rendered images", () => {
    const container = renderSafeHtml('<img src="https://example.com/a.png">');
    const img = container.querySelector("img");
    expect(img?.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(img?.getAttribute("loading")).toBe("lazy");
  });

  it("throws a clear error if rendered without a SanitizerContext.Provider, instead of silently skipping sanitization", () => {
    const renderWithoutProvider = () => render(<SafeHtml html="<p>x</p>" cacheKey="k" />);
    expect(renderWithoutProvider).toThrow(/SanitizerContext/);
  });

  it("degrades to a local safe fallback instead of throwing when the sanitizer itself throws (Finding 3)", () => {
    // Distinct from the "no Provider" case above: here a Provider IS
    // present, but the sanitize function it supplies throws. Without a
    // local guard, this propagates out of `SafeHtml` and is caught only by
    // the app-level `ErrorBoundary` -- which blanks the ENTIRE reading pane
    // for one bad entry, exactly what Slice 3's correction added that
    // boundary to avoid relying on as the primary recovery path.
    const throwingSanitize = () => {
      throw new Error("simulated DOMPurify internal failure");
    };
    const { container } = render(
      <SanitizerContext.Provider value={throwingSanitize}>
        <SafeHtml html="<p>doomed</p>" cacheKey="k" />
      </SanitizerContext.Provider>,
    );

    // No exception escaped the render, and no unsanitized markup reached
    // the DOM -- the component rendered its own local fallback.
    expect(container.querySelector("[role='alert']")).not.toBeNull();
    expect(container.textContent).not.toContain("doomed");
  });
});
