import { useEffect, useState } from "preact/hooks";

/**
 * The desktop layout breakpoint.
 * This is the ONE place the pixel value is defined in application code;
 * App.tsx imports `DESKTOP_QUERY` from here rather than declaring its own
 * copy. `grid.css`'s `@media (min-width: ...)` rule is a second, unavoidable
 * literal: plain CSS has no mechanism to import a JS constant. That second
 * literal is kept in sync by an automated consistency test
 * (src/styles/grid.test.ts), which reads both values and fails the moment
 * they diverge - this is honest drift *prevention* via a test, not true
 * elimination of the duplication.
 */
export const DESKTOP_BREAKPOINT_PX = 768;
export const DESKTOP_QUERY = `(min-width: ${DESKTOP_BREAKPOINT_PX}px)`;

/**
 * Thin wrapper over `window.matchMedia` so App.tsx can drive the
 * mobile/desktop pane-collapse decision from a media query string. jsdom
 * does not implement `matchMedia`; tests stub it explicitly (see
 * App.test.tsx and src/test/setup.ts).
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const mediaQueryList = window.matchMedia(query);
    const listener = (event: MediaQueryListEvent) => setMatches(event.matches);

    setMatches(mediaQueryList.matches);
    mediaQueryList.addEventListener("change", listener);

    return () => mediaQueryList.removeEventListener("change", listener);
  }, [query]);

  return matches;
}
