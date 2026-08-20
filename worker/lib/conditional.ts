/**
 * Conditional-GET header plumbing between client, relay, and origin
 * (header flow and 304 path). Pure header transforms —
 * no fetch, no I/O.
 */

const CONDITIONAL_REQUEST_HEADERS = ["if-none-match", "if-modified-since"] as const;
const CONDITIONAL_RESPONSE_HEADERS = ["etag", "last-modified"] as const;

const RELAY_ACCEPT_HEADER = [
  "application/rss+xml",
  "application/atom+xml",
  "application/xml",
  "text/xml",
  "application/rdf+xml",
  "application/json",
  "application/feed+json",
  "text/json",
  "text/plain",
].join(", ");

/**
 * Builds the headers sent to the origin: forwards the client's conditional
 * validators verbatim, plus the relay's own fixed Accept/User-Agent
 * (the relay → origin header row — these two are never derived from
 * the client request).
 */
export function buildOriginRequestHeaders(clientRequest: Request): Headers {
  const headers = new Headers({
    Accept: RELAY_ACCEPT_HEADER,
    "User-Agent": "ReaderSS/1.0 (+relay)",
  });

  for (const name of CONDITIONAL_REQUEST_HEADERS) {
    const value = clientRequest.headers.get(name);
    if (value !== null) headers.set(name, value);
  }

  return headers;
}

/**
 * Copies ETag/Last-Modified from the origin response onto an outgoing
 * client-facing Headers instance, verbatim.
 */
export function copyConditionalValidators(origin: Response, out: Headers): void {
  for (const name of CONDITIONAL_RESPONSE_HEADERS) {
    const value = origin.headers.get(name);
    if (value !== null) out.set(name, value);
  }
}

/**
 * Builds the 304 response returned to the client when the origin confirms
 * the feed is unchanged: empty body, validators echoed, and the upstream
 * status recorded for client diagnostics (304 path).
 */
export function buildNotModifiedResponse(origin: Response): Response {
  const headers = new Headers();
  copyConditionalValidators(origin, headers);
  headers.set("X-Relay-Origin-Status", "304");
  return new Response(null, { status: 304, headers });
}
