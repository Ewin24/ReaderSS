import { useSanitizer } from "./SanitizerContext";

export interface SafeHtmlProps {
  /** Raw, feed-supplied HTML. Never pre-sanitized -- this component is the boundary. */
  html: string;
  /** design.md §5: `entryId + contentHash`, used by the sanitizer's LRU memo. */
  cacheKey: string;
}

/**
 * THE ONLY `dangerouslySetInnerHTML` in the entire repository (design.md
 * §5). Enforced three ways: the `no-restricted-syntax` ESLint rule bans the
 * attribute everywhere else, with a single file-level override scoped to
 * this exact file (eslint.config.js); the guard test in
 * `src/adapters/security/rawHtmlSinkGuard.test.ts` scans the source tree and
 * fails if the pattern appears anywhere else, or if an eslint-disable
 * comment silences either rule anywhere; and this component itself refuses
 * to render at all (`useSanitizer` throws) if no sanitizer was provided,
 * rather than falling back to an unsanitized render.
 *
 * The call to `sanitize()` itself is also guarded locally. The app-level
 * `ErrorBoundary` is a distant last resort, not the intended recovery path
 * for one bad entry -- relying
 * on it alone means a single throw from DOMPurify blanks the entire reading
 * pane instead of just that one entry. On an unexpected throw here, this
 * component degrades to a local, visibly-marked fallback and renders no
 * markup from `html` at all, sanitized or not.
 */
export function SafeHtml({ html, cacheKey }: SafeHtmlProps) {
  const sanitize = useSanitizer();

  let clean: string;
  try {
    clean = sanitize(html, cacheKey);
  } catch (error) {
    console.error("SafeHtml: sanitize() threw; rendering a local fallback instead of this entry's content.", error);
    return (
      <div class="prose safe-html-fallback" role="alert">
        Unable to display this entry&apos;s content.
      </div>
    );
  }

  // No eslint-disable comment here on purpose: the guard test explicitly
  // fails if one names the banned rule anywhere in the source tree, so the
  // exemption for this exact file lives in eslint.config.js's scoped
  // `files` override instead of a per-line disable comment.
  return <div class="prose" dangerouslySetInnerHTML={{ __html: clean }} />;
}
