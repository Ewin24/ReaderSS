/**
 * Shared by EntryListItem and ReadingPane. Deliberately not locale/timezone
 * dependent (no `toLocaleDateString`) so rendered output is deterministic
 * in tests and consistent across the app.
 *
 * `AppEntry.publishedAt`'s TypeScript type is non-nullable, but that is a
 * compile-time contract over fixture data only. Real parsed feeds (slices
 * 4-9) commonly omit or mangle `pubDate`, so this function guards its input
 * at runtime: non-string, empty, or unparseable values return an explicit
 * "Unknown date" fallback instead of throwing or rendering the literal
 * "Invalid Date". It does not attempt to parse or reformat non-ISO date
 * strings; that is out of scope here.
 */
const ISO_DATE_PREFIX = /^\d{4}-\d{2}-\d{2}/;
const FALLBACK = "Unknown date";

export function formatPublished(iso: string): string {
  if (typeof iso !== "string" || iso.trim() === "") {
    return FALLBACK;
  }
  if (!ISO_DATE_PREFIX.test(iso) || Number.isNaN(Date.parse(iso))) {
    return FALLBACK;
  }
  return iso.slice(0, 10);
}
