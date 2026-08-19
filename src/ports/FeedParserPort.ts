import type { Entry } from "../domain/models/Entry";

/**
 * Port over turning a feed's raw response body into normalized domain
 * entries (design.md §1, §3). The only production implementation is
 * `adapters/feed/feedParser.ts`'s `feedParser` export, which depends on the
 * third-party `feedsmith` library -- the reason this logic lives under
 * `adapters/**` despite doing no I/O of its own, and therefore the reason
 * `services/**` (which may import `domain/**` and `ports/**` only, never
 * `adapters/**` directly, per eslint.config.js's layer-zone rule) depends on
 * this port instead of importing the parser module directly.
 */
export interface ParsedFeed {
  readonly title: string;
  readonly siteUrl: string | null;
  readonly entries: readonly Entry[];
}

/**
 * feedsmith throws an `Error` both when nothing about the input resembles
 * any supported feed format (feed-subscriptions spec, "URL is not a feed")
 * and when a recognized root element contains genuinely broken markup its
 * underlying parser cannot tolerate. Distinguishing those two would require
 * parsing feedsmith's error message text, which is not a stable contract,
 * so both fold into this single code.
 */
export type FeedParseErrorCode = "PARSE_FAILED";

export type FeedParseResult =
  | { readonly status: "parsed"; readonly feed: ParsedFeed }
  | { readonly status: "error"; readonly code: FeedParseErrorCode; readonly message: string };

export interface ParseFeedBodyParams {
  readonly body: string;
  readonly feedId: string;
  readonly fetchedAt: string;
}

export interface FeedParserPort {
  parse(params: ParseFeedBodyParams): FeedParseResult;
}
