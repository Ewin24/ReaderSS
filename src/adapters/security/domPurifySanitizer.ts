/**
 * THE single production module allowed to import `dompurify` (enforcement
 * layer 2 of 3: `eslint.config.js`'s `no-restricted-imports`; layer 3: the
 * guard test in this same directory).
 *
 * Decision, stated explicitly: RAW feed HTML is stored in
 * IndexedDB and sanitized HERE, at render time, never at ingestion.
 * IndexedDB is therefore never a trust boundary -- a future write path that
 * skipped this adapter would still be caught the next time the content is
 * rendered, because rendering is the only path that reaches the DOM at all
 * (see `ui/components/SafeHtml`, this choke point's only caller).
 *
 * Remote images (`<img src="https://...">`) are DELIBERATELY allowed
 * through, not stripped. Rationale, made explicit rather than left implicit:
 * a feed reader that cannot show inline images is broken for most real
 * feeds. The privacy cost -- a remote image request reveals the reader's IP
 * and read time to the feed's own server -- is accepted for MVP and
 * mitigated, not eliminated: `referrerpolicy="no-referrer"` is force-set on
 * every `<img>` below (so the referring page URL is never leaked to the
 * image host), `loading="lazy"` avoids fetching images that are never
 * scrolled into view, and the CSP's `Referrer-Policy: no-referrer` applies
 * the same policy at the browser level (worker/headers/security.ts).
 * Proxying images through the relay would close the IP-leak gap entirely
 * but was rejected for MVP as extra relay traffic/cost, and noted here as a
 * follow-up, not silently dropped.
 */
import DOMPurify from "dompurify";
import type { SanitizerPort } from "../../ports/SanitizerPort";

const LRU_CAPACITY = 100;

/**
 * The 100-entry capacity above bounds
 * KEY COUNT only, not memory -- one hundred very large sanitized documents
 * is still one hundred very large documents held in memory. These two
 * constants add a size-aware bound on top of it.
 */
// A single sanitized document larger than this is never memoized at all: it
// is still sanitized and returned, just not cached, so one abnormally large
// entry cannot itself dominate the cache's memory footprint.
export const MAX_CACHEABLE_ENTRY_BYTES = 200_000; // ~200 KB
// Running total across every cached entry. Well below the relay's 5 MiB
// per-fetch cap -- this bounds the SANITIZED-HTML cache's own memory
// footprint, not any single feed fetch.
export const MAX_TOTAL_CACHE_BYTES = 2_000_000; // ~2 MB

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

const DOMPURIFY_CONFIG = {
  // Restricting to the html profile (no svg/mathml) is what removes every
  // SVG-based vector (e.g. `<svg><use xlink:href="...">`) wholesale: those
  // tags simply are not part of the allowed profile, so DOMPurify drops
  // them regardless of FORBID_TAGS.
  USE_PROFILES: { html: true },
  ALLOWED_URI_REGEXP: /^(?:https?|mailto):/i,
  // DOMPurify's `Config` type declares these as plain mutable `string[]`,
  // so this object is intentionally not `as const` -- a readonly tuple type
  // here does not match its `sanitize()` overload.
  // `<noscript>` is deliberately NOT listed here: DOMPurify's default "html"
  // allow-list (USE_PROFILES: { html: true }) does not include `noscript`
  // among its allowed tags at all, so any `<noscript>` is already stripped --
  // and the classic noscript mXSS parser-context-switch payload (a nested
  // `</noscript>` smuggled inside a `title` attribute) is neutralized as a
  // result, verified empirically in domPurifySanitizer.test.ts and
  // SafeHtml.test.tsx. FORBID_TAGS is reserved for tags the default profile
  // would otherwise allow.
  FORBID_TAGS: ["style", "form", "input", "button", "iframe", "object", "embed"] as string[],
  FORBID_ATTR: ["style", "srcset"] as string[],
  ADD_ATTR: ["target", "rel", "loading", "referrerpolicy"] as string[],
};

let hookInstalled = false;

/**
 * `DOMPurify.addHook` registers against the shared module-level DOMPurify
 * instance, so it must be installed exactly once per process regardless of
 * how many `DomPurifySanitizer` instances are constructed.
 */
function ensureHookInstalled(): void {
  if (hookInstalled) return;
  hookInstalled = true;
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A") {
      // Outbound links from feed content are isolated (content-security
      // spec): noopener/noreferrer prevents the opened page from reaching
      // back into this window; nofollow additionally denies it an SEO
      // signal from being linked by this app.
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer nofollow");
    }
    if (node.tagName === "IMG") {
      node.setAttribute("loading", "lazy");
      node.setAttribute("referrerpolicy", "no-referrer");
    }
  });
}

/**
 * Small capacity-bounded LRU keyed on `entryId + contentHash`, size-aware
 * on top of the key-count capacity: eviction is driven by whichever bound
 * -- key count or total cached bytes -- is hit first.
 */
class LruCache<K> {
  private readonly store = new Map<K, string>();
  private totalBytes = 0;

  constructor(
    private readonly capacity: number,
    private readonly maxTotalBytes: number,
  ) {}

  get(key: K): string | undefined {
    if (!this.store.has(key)) return undefined;
    const value = this.store.get(key) as string;
    // Re-inserting bumps the key to most-recently-used (Map iteration order
    // follows insertion order, so this is also the eviction order below).
    this.store.delete(key);
    this.store.set(key, value);
    return value;
  }

  set(key: K, value: string): void {
    const valueBytes = byteLength(value);
    if (this.store.has(key)) {
      this.totalBytes -= byteLength(this.store.get(key) as string);
      this.store.delete(key);
    }
    while (
      this.store.size > 0 &&
      (this.store.size >= this.capacity || this.totalBytes + valueBytes > this.maxTotalBytes)
    ) {
      const oldestKey = this.store.keys().next().value as K;
      this.totalBytes -= byteLength(this.store.get(oldestKey) as string);
      this.store.delete(oldestKey);
    }
    this.store.set(key, value);
    this.totalBytes += valueBytes;
  }
}

export class DomPurifySanitizer implements SanitizerPort {
  private readonly cache = new LruCache<string>(LRU_CAPACITY, MAX_TOTAL_CACHE_BYTES);

  constructor() {
    ensureHookInstalled();
  }

  sanitize(html: string, cacheKey: string): string {
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) return cached;
    const clean = DOMPurify.sanitize(html, DOMPURIFY_CONFIG);
    // An oversized single document is sanitized and returned
    // like any other, it just never enters the cache.
    if (byteLength(clean) <= MAX_CACHEABLE_ENTRY_BYTES) {
      this.cache.set(cacheKey, clean);
    }
    return clean;
  }
}
