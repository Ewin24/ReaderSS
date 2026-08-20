/**
 * Port over the single enforced DOMPurify choke point. The
 * only production implementation is `adapters/security/domPurifySanitizer.ts`.
 * `ui/components/SafeHtml` never imports this port directly (ui/components/**
 * may only import `domain/models`, per the layer-zone rule in
 * `eslint.config.js`); instead it consumes a plain sanitize function handed
 * down through a Preact context whose value is this port's `sanitize` method,
 * bound at the composition root (`main.tsx`).
 */
export interface SanitizerPort {
  /**
   * Sanitizes raw, feed-supplied HTML for safe DOM insertion. `cacheKey`
   * (`entryId + contentHash`) lets the implementation memoize
   * so repeated renders of the same unchanged entry (e.g. scrolling) do not
   * re-run DOMPurify.
   */
  sanitize(html: string, cacheKey: string): string;
}
