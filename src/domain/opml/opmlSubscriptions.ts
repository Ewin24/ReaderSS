/**
 * OPML outline tree -> flat subscription list. Pure domain logic: no I/O, no
 * XML parsing, no third-party types. Turning the OPML *document* into the
 * outline tree is an adapter's job (`adapters/opml/`, behind
 * `ports/OpmlCodecPort`); this module owns only what the tree MEANS.
 *
 * The input type is structural on purpose. It describes the shape any OPML
 * parser produces, so the domain never depends on which parser produced it.
 */
import { normalizeFeedUrl } from "../url/normalizeFeedUrl";
import { toSafeHref } from "../url/safeUrl";

/** One node of an OPML `<body>` outline tree. */
export interface OpmlOutlineNode {
  /** OPML's `text` attribute (required by the spec, absent in the wild). */
  readonly text?: string | null;
  /** OPML's `title` attribute; preferred over `text` when both exist. */
  readonly title?: string | null;
  /** Present only on feed outlines. Its absence is what makes a node a folder. */
  readonly xmlUrl?: string | null;
  /** OPML 2.0's `description` attribute — where a per-feed note travels. */
  readonly description?: string | null;
  /**
   * OPML 2.0's `category` attribute: "a string of comma-separated
   * slash-delimited category strings" (e.g. `/Tech/Security,/Reading`). It is
   * the ONLY grouping the specification actually defines — folders-by-nesting
   * are a universal convention the spec itself warns "some processors may not
   * understand and preserve".
   */
  readonly category?: string | null;
  readonly outlines?: readonly OpmlOutlineNode[];
}

/** A feed to subscribe to, as described by the OPML file. */
export interface OpmlSubscription {
  /** The feed URL exactly as written in the file (never the normalized form:
   * that is an identity key, not something to fetch). */
  readonly url: string;
  readonly title: string | null;
  readonly folder: string | null;
  /**
   * The feed's own `description`, which becomes its note. A folder's
   * description is NOT inherited by the feeds inside it: it describes the
   * folder, and copying one paragraph onto each of six feeds would be
   * inventing content the file never stated about them.
   */
  readonly note: string | null;
}

function cleanText(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * FOLDER DEPTH, stated rather than left implicit: OPML allows folders nested
 * arbitrarily deep, but a ReaderSS feed carries a single `folder` string. The
 * NEAREST enclosing folder wins, and outer levels are dropped -- a feed under
 * `Tech > Security > Blogs` imports as `Blogs`.
 *
 * The alternative (joining the path into `Tech/Security/Blogs`) was rejected:
 * it invents a path syntax the rest of the app does not understand, and the
 * nearest folder is the one that actually describes the feed.
 */
function folderNameOf(node: OpmlOutlineNode): string | null {
  return cleanText(node.title) ?? cleanText(node.text);
}

/**
 * Reads a folder name out of the OPML 2.0 `category` attribute, for files that
 * group with the attribute instead of by nesting.
 *
 * The attribute holds comma-separated, slash-delimited paths
 * (`/Tech/Security,/Reading`). A ReaderSS feed carries ONE folder name, so:
 * the first path wins, and within it the LAST segment wins -- the same
 * "nearest folder" rule nesting already uses, so a feed grouped either way
 * lands in the same place.
 */
function categoryFolderOf(node: OpmlOutlineNode): string | null {
  const raw = cleanText(node.category);
  if (raw === null) return null;

  const firstPath = raw.split(",")[0];
  const segments = firstPath
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  return segments.length === 0 ? null : segments[segments.length - 1];
}

/**
 * Flattens an outline tree into subscriptions, depth-first, preserving
 * document order.
 *
 * Skipped without ceremony (an OPML file is other software's export, so
 * partial junk is expected, not exceptional):
 * - nodes with no `xmlUrl` and no children -- neither a feed nor a folder;
 * - nodes whose `xmlUrl` is not a safe absolute http(s) URL;
 * - a URL already seen in this same document (first occurrence wins),
 *   compared by {@link normalizeFeedUrl} so the same feed written twice with
 *   a different trailing slash or host case counts once.
 */
export function flattenOpmlOutlines(
  nodes: readonly OpmlOutlineNode[] | undefined,
): OpmlSubscription[] {
  const found: OpmlSubscription[] = [];
  const seen = new Set<string>();

  function walk(list: readonly OpmlOutlineNode[], folder: string | null): void {
    for (const node of list) {
      const rawUrl = cleanText(node.xmlUrl);
      if (rawUrl !== null && toSafeHref(rawUrl) !== null) {
        const identity = normalizeFeedUrl(rawUrl);
        if (!seen.has(identity)) {
          seen.add(identity);
          found.push({
            url: rawUrl,
            title: cleanText(node.title) ?? cleanText(node.text),
            // An enclosing folder wins over `category`: nesting is structure
            // the file's author actually built, while `category` is metadata
            // on the feed. `category` fills in for files that group only that
            // way, which is why both are read rather than one or the other.
            folder: folder ?? categoryFolderOf(node),
            note: cleanText(node.description),
          });
        }
      }

      if (node.outlines && node.outlines.length > 0) {
        // A node can legitimately be BOTH a feed and a container. When it is,
        // its own name becomes the folder for its children.
        walk(node.outlines, folderNameOf(node) ?? folder);
      }
    }
  }

  walk(nodes ?? [], null);
  return found;
}
