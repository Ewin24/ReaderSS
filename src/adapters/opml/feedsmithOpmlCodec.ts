/**
 * `OpmlCodecPort` implemented with feedsmith -- the same library
 * `adapters/feed/feedParser.ts` already uses for RSS/Atom/RDF/JSON Feed, so
 * OPML support costs no new dependency.
 *
 * This adapter does two things and nothing else: it converts between
 * feedsmith's document shape and the domain's outline shape, and it turns
 * feedsmith's thrown errors into the port's typed `invalid` result. All
 * MEANING (what counts as a feed, which folder a feed belongs to, which
 * duplicates collapse) lives in `domain/opml/opmlSubscriptions.ts`.
 */
import { generateOpml, parseOpml } from "feedsmith";
import type { OpmlOutlineNode } from "../../domain/opml/opmlSubscriptions";
import type {
  OpmlCodecPort,
  OpmlExportFeed,
  OpmlExportInput,
  OpmlParseResult,
} from "../../ports/OpmlCodecPort";
import { describeError } from "../../domain/errors/describeError";

/**
 * READ shape: feedsmith's outline nodes narrowed to the fields the domain
 * reads. Every field is optional because real-world OPML omits them -- even
 * `text`, which the spec calls required.
 */
interface ParsedOutline {
  text?: string;
  title?: string;
  xmlUrl?: string;
  description?: string;
  category?: string;
  outlines?: ParsedOutline[];
}

/**
 * WRITE shape: deliberately separate from {@link ParsedOutline}, because
 * feedsmith's generator REQUIRES `text` on every outline. Keeping one loose
 * type for both directions would only push that requirement to a cast.
 */
/**
 * WRITE shape, matching what feed readers actually produce.
 *
 * `type`, `text` and `xmlUrl` are the three attributes OPML 2.0 lists as
 * REQUIRED on a subscription outline, and `title` alongside `text` is what
 * every real exporter writes. Omitting them still parsed here, but produced a
 * document other readers could legitimately reject -- so they are written.
 */
interface WritableOutline {
  text: string;
  type?: string;
  title?: string;
  xmlUrl?: string;
  htmlUrl?: string;
  description?: string;
  outlines?: WritableOutline[];
}

function toDomainOutlines(outlines: readonly ParsedOutline[] | undefined): OpmlOutlineNode[] {
  if (!outlines) return [];
  return outlines.map((outline) => ({
    text: outline.text ?? null,
    title: outline.title ?? null,
    xmlUrl: outline.xmlUrl ?? null,
    description: outline.description ?? null,
    category: outline.category ?? null,
    outlines: toDomainOutlines(outline.outlines),
  }));
}

/**
 * Groups feeds into `<outline>` folders, preserving first-seen folder order
 * and feed order within each folder. Un-foldered feeds stay at the top level.
 */
function toExportOutlines(feeds: readonly OpmlExportFeed[]): WritableOutline[] {
  const rootOutlines: WritableOutline[] = [];
  const foldersByName = new Map<string, WritableOutline>();

  for (const feed of feeds) {
    const label = feed.title ?? feed.url;
    const entry: WritableOutline = {
      // `type="rss"` covers Atom and JSON Feed too: OPML has no separate type
      // for them, and "rss" is what every reader writes for any subscription.
      type: "rss",
      text: label,
      title: label,
      xmlUrl: feed.url,
      ...(feed.siteUrl === null ? {} : { htmlUrl: feed.siteUrl }),
      // Omitted entirely rather than written empty: an OPML consumer reads a
      // missing attribute as "no description", but `description=""` as a
      // description that happens to be blank.
      ...(feed.note === null ? {} : { description: feed.note }),
    };

    if (feed.folder === null) {
      rootOutlines.push(entry);
      continue;
    }

    let folder = foldersByName.get(feed.folder);
    if (!folder) {
      folder = { text: feed.folder, outlines: [] };
      foldersByName.set(feed.folder, folder);
      rootOutlines.push(folder);
    }
    folder.outlines?.push(entry);
  }

  return rootOutlines;
}

/**
 * XML escaping for the one string this module ever writes by hand (the
 * document title in the zero-feed case above). Everything else goes through
 * feedsmith's own writer.
 */
function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Written into `<docs>`, the spec's own way to make a document self-describing. */
const OPML_SPEC_URL = "http://opml.org/spec2.opml";

function EMPTY_OPML_DOCUMENT(title: string, createdAt: string): string {
  const stamp = new Date(createdAt).toUTCString();
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<opml version="2.0">',
    "  <head>",
    `    <title>${escapeXmlText(title)}</title>`,
    `    <dateCreated>${escapeXmlText(stamp)}</dateCreated>`,
    `    <dateModified>${escapeXmlText(stamp)}</dateModified>`,
    `    <docs>${OPML_SPEC_URL}</docs>`,
    "  </head>",
    "  <body/>",
    "</opml>",
    "",
  ].join("\n");
}

export const feedsmithOpmlCodec: OpmlCodecPort = {
  parse(xml: string): OpmlParseResult {
    // feedsmith THROWS on anything it does not recognize as OPML (verified:
    // empty string, plain text, and an HTML document all raise "Invalid OPML
    // format"). Importing someone else's export is precisely where that
    // happens, so it becomes a typed result instead of an escaping exception.
    try {
      const document = parseOpml(xml);
      return {
        status: "parsed",
        title: document.head?.title ?? null,
        outlines: toDomainOutlines(document.body?.outlines as ParsedOutline[] | undefined),
      };
    } catch (error: unknown) {
      return { status: "invalid", message: describeError(error) };
    }
  },

  serialize(input: OpmlExportInput): string {
    // feedsmith REJECTS a document with zero outlines ("Invalid input OPML"),
    // found by the test below rather than assumed. Exporting an empty
    // subscription list is a legitimate thing to do -- and the result must
    // still be a document this same codec can read back -- so that one case
    // is written directly instead of being turned into an error the caller
    // would have to special-case.
    if (input.feeds.length === 0) {
      return EMPTY_OPML_DOCUMENT(input.title, input.createdAt);
    }
    return generateOpml({
      head: {
        title: input.title,
        // What a real export carries: when it was written, and a pointer to
        // the spec it conforms to. `docs` is the spec's own recommendation for
        // making a document self-describing.
        dateCreated: new Date(input.createdAt),
        dateModified: new Date(input.createdAt),
        docs: OPML_SPEC_URL,
      },
      body: { outlines: toExportOutlines(input.feeds) },
    });
  },
};
