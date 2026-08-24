/**
 * Reading and writing OPML documents. A port rather than a plain helper for
 * the same reason `FeedParserPort` is one: parsing OPML means binding to a
 * third-party XML parser, and `services/**` may only import `domain/**` and
 * `ports/**` (enforced by `eslint.config.js`'s `import-x/no-restricted-paths`).
 *
 * The port deals in the domain's own outline shape, so no service or test
 * double ever has to know which parser is behind it.
 */
import type { OpmlOutlineNode } from "../domain/opml/opmlSubscriptions";

/**
 * A malformed document is a RESULT, not an exception: importing someone
 * else's export file is exactly where malformed input is expected, and the UI
 * has to say what went wrong rather than crash.
 */
export type OpmlParseResult =
  | {
      readonly status: "parsed";
      /** The document's own title, when it declares one. */
      readonly title: string | null;
      readonly outlines: readonly OpmlOutlineNode[];
    }
  | { readonly status: "invalid"; readonly message: string };

/** One feed as it should appear in an exported OPML document. */
export interface OpmlExportFeed {
  readonly url: string;
  readonly title: string | null;
  readonly folder: string | null;
  /** Round-trips as the OPML 2.0 `description` attribute. */
  readonly note: string | null;
  /** The feed's site, written as `htmlUrl` when known. */
  readonly siteUrl: string | null;
}

export interface OpmlExportInput {
  readonly title: string;
  readonly feeds: readonly OpmlExportFeed[];
  /**
   * When the document was written, as an ISO-8601 string. Supplied by the
   * caller (from `ClockPort`) rather than read from the system clock here, so
   * the codec stays a pure function of its input and testable without faking
   * time.
   */
  readonly createdAt: string;
}

export interface OpmlCodecPort {
  parse(xml: string): OpmlParseResult;
  /** Serializes subscriptions into an OPML 2.0 document. */
  serialize(input: OpmlExportInput): string;
}
