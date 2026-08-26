/**
 * Searching everything you are subscribed to: feed titles, your own notes,
 * entry titles, and entry bodies. Pure -- no store, no DOM, no I/O. The
 * caller hands in the corpus, this returns ranked results with a preview of
 * the text around each match.
 *
 * TEXT, NEVER HTML. `htmlToText` below turns feed HTML into plain text so it
 * can be searched and previewed. It is NOT sanitization and must never be
 * used to produce something that gets rendered as markup -- the single
 * sanitization choke point is still `SafeHtml`/DOMPurify, and every snippet
 * this module returns is meant to land in a TEXT node, where Preact escapes
 * it. That is also why a snippet is returned in three PIECES (`before`,
 * `match`, `after`) instead of as a string with the match wrapped in a tag:
 * the highlight is built out of elements by the component, so there is no
 * point anywhere in this path where a string becomes markup.
 *
 * COST, stated rather than hidden: a search walks the entire corpus and
 * strips every candidate body. There is no persistent index, so the work is
 * proportional to how much you have stored, and it is redone for each query
 * (the caller debounces). At this project's retention scale that is a short
 * pause on a query, not a freeze; if a library ever grows past what that can
 * carry, an index built at write time is the answer, not a silent cap on how
 * much of your library gets searched.
 */

/** Shorter than this matches too much to be worth showing. */
export const MIN_QUERY_LENGTH = 2;

/** How many results are returned unless the caller asks for another number. */
export const DEFAULT_SEARCH_LIMIT = 20;

/** Characters of context kept on each side of a match in a preview. */
const SNIPPET_CONTEXT = 60;

/** The minimum a feed must expose to be searchable. */
export interface SearchableFeed {
  readonly id: string;
  readonly title: string;
  /** Your own note about the feed. Searched: it is your writing about why
   * this feed is here, which is often what you remember rather than a title. */
  readonly note: string | null;
}

/** The minimum an entry must expose to be searchable. */
export interface SearchableEntry {
  readonly id: string;
  readonly feedId: string;
  readonly title: string;
  readonly publishedAt: string;
  /** Raw feed HTML (content, else summary), or `null` when the entry has
   * neither. Never rendered from here -- see the module note above. */
  readonly bodyHtml: string | null;
}

export interface SearchCorpus {
  /** In the order the caller wants matches shown; results preserve it. */
  readonly feeds: readonly SearchableFeed[];
  /** Same: supply these newest-first and the results come out newest-first. */
  readonly entries: readonly SearchableEntry[];
}

/**
 * The text around a match, split so the component can highlight the middle
 * piece without ever building markup. `before`/`after` already carry their
 * ellipsis when the text was cut.
 */
export interface SearchSnippet {
  readonly before: string;
  readonly match: string;
  readonly after: string;
}

export interface FeedSearchResult {
  readonly kind: "feed";
  readonly feedId: string;
  readonly feedTitle: string;
  readonly matchedIn: "title" | "note";
  readonly snippet: SearchSnippet;
}

export interface EntrySearchResult {
  readonly kind: "entry";
  readonly entryId: string;
  readonly feedId: string;
  readonly feedTitle: string;
  readonly title: string;
  readonly publishedAt: string;
  readonly matchedIn: "title" | "body";
  readonly snippet: SearchSnippet;
}

export type SearchResult = FeedSearchResult | EntrySearchResult;

export interface SearchOutcome {
  /** The trimmed query the results belong to, so a caller can drop a stale
   * response without tracking request ids of its own. */
  readonly query: string;
  readonly results: readonly SearchResult[];
  /** How many matched in total, which is NOT `results.length` once the limit
   * bites. Reported so the UI can say how much it is not showing instead of
   * quietly truncating. */
  readonly totalCount: number;
}

/**
 * A case- and accent-insensitive copy of a string, plus a map from each
 * position in that copy back to the position it came from in the original.
 *
 * The map is the point. Folding can change a string's length ("á" is one
 * character, its decomposition is two), so an offset found in the folded text
 * does not address the same character in the original. Highlighting the wrong
 * span is a quiet, plausible-looking defect, so the mapping is built
 * explicitly rather than assumed to be one-to-one.
 */
interface FoldedText {
  readonly text: string;
  /** `map[i]` is the index in the ORIGINAL string that `text[i]` came from. */
  readonly map: readonly number[];
}

const DIACRITICS = /\p{Diacritic}/gu;

function fold(source: string): FoldedText {
  const out: string[] = [];
  const map: number[] = [];
  for (let i = 0; i < source.length; i += 1) {
    // Per character, so every produced character keeps the index it came
    // from. A character that folds away entirely (a bare combining mark)
    // simply contributes nothing and the map stays aligned.
    const folded = source[i].normalize("NFD").replace(DIACRITICS, "").toLowerCase();
    for (const character of folded) {
      out.push(character);
      map.push(i);
    }
  }
  return { text: out.join(""), map };
}

/** Folds a query for comparison; no map needed, only the text. */
function foldQuery(query: string): string {
  return fold(query).text;
}

const BLOCK_END =
  /<\/(?:p|div|section|article|li|ul|ol|h[1-6]|tr|table|blockquote|pre|figcaption)\s*>/gi;

/**
 * HTML in, plain text out, for searching and previewing only.
 *
 * Deliberately a set of regular expressions and not a parser: the browser
 * parsers are exactly the raw-HTML sinks this repo bans, and a real parse is
 * not needed to answer "does this article say X, and what is around it". Its
 * output is never markup (see the module note), so the usual reason to
 * distrust regex-over-HTML -- that a crafted document escapes the pattern and
 * something dangerous gets rendered -- does not apply: the worst case here is
 * a preview with an odd-looking character in it.
 */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      // Script/style bodies are code, not prose: dropped whole so a stylesheet
      // cannot match a search for a word that never appears on screen.
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(BLOCK_END, " ")
      .replace(/<[^>]*>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
};

/**
 * Decodes the entity forms that actually turn up in feed bodies. Unknown
 * entities are left exactly as written rather than guessed at -- a literal
 * `&foo;` in a preview is honest; a wrong character is not.
 */
function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith("#")) {
      const codePoint = body.startsWith("#x") || body.startsWith("#X")
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      if (!Number.isFinite(codePoint) || codePoint <= 0 || codePoint > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return whole;
      }
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/**
 * Builds the preview around a match found at `foldedIndex` in `folded`,
 * cutting on the ORIGINAL text so the preview reads the way the source does.
 */
function snippetAt(
  source: string,
  folded: FoldedText,
  foldedIndex: number,
  foldedLength: number,
): SearchSnippet {
  const start = folded.map[foldedIndex] ?? 0;
  const lastFolded = Math.min(foldedIndex + foldedLength - 1, folded.map.length - 1);
  const end = (folded.map[lastFolded] ?? start) + 1;

  const beforeStart = Math.max(0, start - SNIPPET_CONTEXT);
  const afterEnd = Math.min(source.length, end + SNIPPET_CONTEXT);

  const before = (beforeStart > 0 ? "…" : "") + source.slice(beforeStart, start);
  const after = source.slice(end, afterEnd) + (afterEnd < source.length ? "…" : "");

  return { before, match: source.slice(start, end), after };
}

/** Finds `query` in `source`, folded, and returns the preview around it. */
function findMatch(source: string, foldedQuery: string): SearchSnippet | null {
  const folded = fold(source);
  const index = folded.text.indexOf(foldedQuery);
  if (index === -1) return null;
  return snippetAt(source, folded, index, foldedQuery.length);
}

export interface SearchOptions {
  readonly limit?: number;
}

/**
 * Searches the corpus and ranks what it finds.
 *
 * ORDER, decided rather than incidental:
 *   1. feeds, because "take me to that feed" is a different question from
 *      "find me that article", and there are only ever a handful of them;
 *   2. entries matched by TITLE, because a title match is almost always the
 *      thing you were thinking of;
 *   3. entries matched only in the BODY.
 * Inside each bucket the caller's own order is preserved, so entries handed
 * in newest-first come out newest-first.
 *
 * An entry that matches in its title is reported ONCE, as a title match --
 * the same article listed twice for one query is noise, and the title match
 * is the more useful of the two.
 */
export function searchCorpus(
  corpus: SearchCorpus,
  query: string,
  options: SearchOptions = {},
): SearchOutcome {
  const trimmed = query.trim();
  const limit = options.limit ?? DEFAULT_SEARCH_LIMIT;

  if (trimmed.length < MIN_QUERY_LENGTH) {
    return { query: trimmed, results: [], totalCount: 0 };
  }

  const needle = foldQuery(trimmed);
  // A query of nothing but accents/marks folds away to an empty string, which
  // `indexOf` would match at every position.
  if (needle.length === 0) {
    return { query: trimmed, results: [], totalCount: 0 };
  }

  const feedResults: FeedSearchResult[] = [];
  const feedTitles = new Map<string, string>();

  for (const feed of corpus.feeds) {
    feedTitles.set(feed.id, feed.title);

    const titleMatch = findMatch(feed.title, needle);
    if (titleMatch) {
      feedResults.push({
        kind: "feed",
        feedId: feed.id,
        feedTitle: feed.title,
        matchedIn: "title",
        snippet: titleMatch,
      });
      continue;
    }
    const noteMatch = feed.note === null ? null : findMatch(feed.note, needle);
    if (noteMatch) {
      feedResults.push({
        kind: "feed",
        feedId: feed.id,
        feedTitle: feed.title,
        matchedIn: "note",
        snippet: noteMatch,
      });
    }
  }

  const titleResults: EntrySearchResult[] = [];
  const bodyResults: EntrySearchResult[] = [];

  for (const entry of corpus.entries) {
    const feedTitle = feedTitles.get(entry.feedId) ?? "Unknown feed";

    const titleMatch = findMatch(entry.title, needle);
    if (titleMatch) {
      titleResults.push({
        kind: "entry",
        entryId: entry.id,
        feedId: entry.feedId,
        feedTitle,
        title: entry.title,
        publishedAt: entry.publishedAt,
        matchedIn: "title",
        snippet: titleMatch,
      });
      continue;
    }

    if (entry.bodyHtml === null) continue;
    const bodyMatch = findMatch(htmlToText(entry.bodyHtml), needle);
    if (bodyMatch) {
      bodyResults.push({
        kind: "entry",
        entryId: entry.id,
        feedId: entry.feedId,
        feedTitle,
        title: entry.title,
        publishedAt: entry.publishedAt,
        matchedIn: "body",
        snippet: bodyMatch,
      });
    }
  }

  const all: SearchResult[] = [...feedResults, ...titleResults, ...bodyResults];
  return {
    query: trimmed,
    results: limit >= 0 ? all.slice(0, limit) : all,
    totalCount: all.length,
  };
}

/** An outcome with nothing in it, for a caller with no query yet. */
export function emptySearchOutcome(query = ""): SearchOutcome {
  return { query: query.trim(), results: [], totalCount: 0 };
}
