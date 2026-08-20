const ALLOWED_SCHEMES = new Set(["http:", "https:"]);

/**
 * Restricts a feed-supplied URL to the http(s) scheme allow-list before it
 * reaches a `href`/`src` sink as a scalar JSX attribute value (e.g. an
 * anchor's `href` built directly from `entry.link`).
 *
 * Deliberately separate from the DOMPurify boundary (src/adapters/security):
 * DOMPurify sanitizes HTML *strings* before DOM insertion. This
 * function guards a different sink - a single URL value assigned straight
 * to a JSX attribute - which the HTML sanitizer never sees. Malformed input
 * (not a valid absolute URL) and disallowed schemes (`javascript:`,
 * `data:`, `vbscript:`, etc.) both return `null` so the caller can degrade
 * honestly by omitting the link/image, instead of rendering a broken or
 * dangerous one.
 */
export function toSafeHref(url: string): string | null {
  if (typeof url !== "string" || url.trim() === "") {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  return ALLOWED_SCHEMES.has(parsed.protocol) ? url : null;
}
