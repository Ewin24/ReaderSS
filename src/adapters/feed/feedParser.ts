/**
 * Feedsmith -> domain `Entry[]` (design.md §1, §3). The only production
 * module that imports `feedsmith`. Handles RSS 2.0, RSS 1.0/RDF, Atom, and
 * JSON Feed (feed-fetching spec, "Multi-format parsing on the client").
 *
 * Content passed through here is the feed's RAW, pre-sanitization HTML.
 * Nothing in this file sanitizes anything -- sanitization happens once, at
 * render time, in `src/ui/components/SafeHtml` (design.md §5). This module
 * only normalizes shape and derives identity/dedup keys.
 */
import { parseFeed } from "feedsmith";
import type { Atom, DeepPartial, Json, Rdf, Rss } from "feedsmith/types";
import { createEntry, type Entry } from "../../domain/models/Entry";
import { deriveEntryIdentity } from "../../domain/identity/entryIdentity";
import { shortHash } from "../../domain/identity/hash";
import type { FeedParserPort, FeedParseResult, ParseFeedBodyParams } from "../../ports/FeedParserPort";

export type { ParsedFeed, FeedParseErrorCode, FeedParseResult, ParseFeedBodyParams } from "../../ports/FeedParserPort";

interface RawEntry {
  readonly guid: string | null;
  readonly entryId: string | null;
  readonly title: string;
  readonly link: string | null;
  readonly publishedAt: string | null;
  readonly summaryHtml: string | null;
  readonly contentHtml: string | null;
}

function toIsoDateOrFallback(raw: string | Date | null | undefined, fallback: string): string {
  if (raw === null || raw === undefined) return fallback;
  const date = raw instanceof Date ? raw : new Date(raw);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

/**
 * JSON Feed's `content_text` is plain text, not HTML, but `Entry.contentHtml`
 * is always treated as HTML by the sanitizer boundary downstream. Escaping
 * it here means an unescaped "<" in plain text renders as literal text after
 * sanitization instead of being interpreted (and possibly stripped) as a
 * broken tag.
 */
function escapePlainTextToHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildEntries(feedId: string, fetchedAt: string, raws: readonly RawEntry[]): Entry[] {
  const entries: Entry[] = [];
  for (const raw of raws) {
    // feed-fetching spec requires "a resolvable link" on every normalized
    // entry; an item that supplies neither its own link nor a feed-level
    // fallback has nothing for the reading pane to open, so it is dropped
    // rather than persisted with a link the app can never resolve.
    if (raw.link === null) continue;

    const identity = deriveEntryIdentity({
      feedId,
      guid: raw.guid,
      id: raw.entryId,
      link: raw.link,
      publishedAt: raw.publishedAt,
      title: raw.title,
    });
    const contentHash = shortHash(raw.title + raw.link + (raw.contentHtml ?? raw.summaryHtml ?? ""));

    entries.push(
      createEntry({
        id: identity,
        feedId,
        guid: raw.guid,
        contentHash,
        title: raw.title,
        link: raw.link,
        publishedAt: raw.publishedAt ?? fetchedAt,
        fetchedAt,
        summaryHtml: raw.summaryHtml,
        contentHtml: raw.contentHtml,
        hasFullContent: raw.contentHtml !== null ? 1 : 0,
      }),
    );
  }
  return entries;
}

function mapRss(feed: DeepPartial<Rss.Feed<string>>, params: ParseFeedBodyParams): FeedParseResult {
  const siteUrl = feed.link ?? null;
  const raws: RawEntry[] = (feed.items ?? []).map((item) => {
    const link = item?.link ?? siteUrl;
    const publishedAt = toIsoDateOrFallback(item?.pubDate, params.fetchedAt);
    return {
      guid: item?.guid?.value ?? null,
      entryId: null,
      title: item?.title ?? item?.description?.slice(0, 120) ?? "Untitled",
      link,
      publishedAt,
      summaryHtml: item?.description ?? null,
      contentHtml: item?.content?.encoded ?? null,
    };
  });
  return {
    status: "parsed",
    feed: {
      title: feed.title ?? "Untitled feed",
      siteUrl,
      entries: buildEntries(params.feedId, params.fetchedAt, raws),
    },
  };
}

function mapRdf(feed: DeepPartial<Rdf.Feed<string>>, params: ParseFeedBodyParams): FeedParseResult {
  const siteUrl = feed.link ?? null;
  const raws: RawEntry[] = (feed.items ?? []).map((item) => {
    const link = item?.link ?? siteUrl;
    return {
      // RDF items carry no guid element; rdf:about is the stable per-item
      // URI RDF itself uses as identity, so it is the closest equivalent.
      guid: item?.rdf?.about ?? null,
      entryId: null,
      title: item?.title ?? "Untitled",
      link,
      publishedAt: null,
      summaryHtml: item?.description ?? null,
      contentHtml: item?.content?.encoded ?? null,
    };
  });
  return {
    status: "parsed",
    feed: {
      title: feed.title ?? "Untitled feed",
      siteUrl,
      entries: buildEntries(params.feedId, params.fetchedAt, raws),
    },
  };
}

function pickAtomLink(links: DeepPartial<Array<Atom.Link<string>>> | undefined): string | null {
  if (!links || links.length === 0) return null;
  const alternate = links.find((link) => link.rel === "alternate" || link.rel === undefined);
  return (alternate ?? links[0])?.href ?? null;
}

function mapAtom(feed: DeepPartial<Atom.Feed<string>>, params: ParseFeedBodyParams): FeedParseResult {
  const siteUrl = pickAtomLink(feed.links);
  const raws: RawEntry[] = (feed.entries ?? []).map((entry) => {
    const link = pickAtomLink(entry?.links) ?? siteUrl;
    const publishedAt = toIsoDateOrFallback(entry?.published ?? entry?.updated, params.fetchedAt);
    return {
      guid: null,
      entryId: entry?.id ?? null,
      title: entry?.title ?? "Untitled",
      link,
      publishedAt,
      summaryHtml: entry?.summary ?? null,
      contentHtml: entry?.content ?? null,
    };
  });
  return {
    status: "parsed",
    feed: {
      title: feed.title ?? "Untitled feed",
      siteUrl,
      entries: buildEntries(params.feedId, params.fetchedAt, raws),
    },
  };
}

function mapJson(feed: DeepPartial<Json.Feed<string>>, params: ParseFeedBodyParams): FeedParseResult {
  const siteUrl = feed.home_page_url ?? null;
  const raws: RawEntry[] = (feed.items ?? []).map((item) => {
    const link = item?.url ?? item?.external_url ?? siteUrl;
    const publishedAt = toIsoDateOrFallback(item?.date_published, params.fetchedAt);
    const contentHtml =
      item?.content_html ?? (item?.content_text ? escapePlainTextToHtml(item.content_text) : null);
    return {
      guid: null,
      entryId: item?.id ?? null,
      title: item?.title ?? "Untitled",
      link,
      publishedAt,
      summaryHtml: item?.summary ?? null,
      contentHtml,
    };
  });
  return {
    status: "parsed",
    feed: {
      title: feed.title ?? "Untitled feed",
      siteUrl,
      entries: buildEntries(params.feedId, params.fetchedAt, raws),
    },
  };
}

/**
 * `FeedParserPort`-conformant object for production wiring (composition
 * root only, per design.md §1). `services/**` depends on `FeedParserPort`,
 * never on this module directly -- `parseFeedBody` stays a plain exported
 * function (rather than only a private implementation of the object below)
 * so tests can call it directly without going through the port indirection.
 */
export const feedParser: FeedParserPort = {
  parse: (params) => parseFeedBody(params),
};

export function parseFeedBody(params: ParseFeedBodyParams): FeedParseResult {
  try {
    const parsed = parseFeed(params.body);
    switch (parsed.format) {
      case "rss":
        return mapRss(parsed.feed, params);
      case "atom":
        return mapAtom(parsed.feed, params);
      case "rdf":
        return mapRdf(parsed.feed, params);
      case "json":
        return mapJson(parsed.feed, params);
    }
  } catch (error) {
    return {
      status: "error",
      code: "PARSE_FAILED",
      message: error instanceof Error ? error.message : "the feed could not be parsed",
    };
  }
}
