/**
 * SSRF boundary for the feed relay (design.md §2 "Abuse: an open fetch
 * relay is an open proxy"). Applied by worker/routes/feed.ts to the `url`
 * query parameter and re-applied to every redirect `Location` header, since
 * a redirect can point somewhere the original URL did not.
 *
 * This guard validates a *hostname string* at the moment of the check. It
 * has no control over DNS resolution: the Workers runtime resolves DNS
 * itself, with no socket-level IP pinning available to this code. A
 * hostname that is public when this guard runs could resolve to a private
 * address on the actual outbound fetch a moment later (DNS rebinding /
 * TOCTOU). That risk is not preventable at this layer — see design.md §2's
 * "What the relay cannot prevent" table. Nothing in this file claims to
 * close it.
 *
 * It relies on one WHATWG URL Standard behavior instead of re-implementing
 * it: `new URL()` already normalizes decimal/octal/hex/mixed IPv4-literal
 * encodings (e.g. "2130706433", "0x7f000001") into canonical dotted-quad
 * form, and already rejects any domain whose last label is all-digits
 * unless the whole host parses as a valid IPv4 address. The range checks
 * below run against that normalized `URL#hostname`, not against the raw
 * input string.
 */

export type TargetUrlRejectionReason =
  | "unparseable"
  | "unsupported_scheme"
  | "embedded_credentials"
  | "disallowed_port"
  | "blocked_hostname";

export type TargetUrlGuardResult =
  | { readonly allowed: true; readonly url: URL }
  | {
      readonly allowed: false;
      readonly reason: TargetUrlRejectionReason;
      readonly detail: string;
      /**
       * The hostname of the URL that was actually rejected, when parseable
       * (`null` only for `reason: "unparseable"`, where no hostname exists
       * to report). Callers (`worker/routes/feed.ts`) use this to report
       * the hop that was actually blocked, not a previously-validated hop's
       * hostname.
       */
      readonly hostname: string | null;
    };

const ALLOWED_PORTS = new Set(["", "80", "443"]);

const BLOCKED_HOSTNAME_EXACT = new Set(["localhost"]);
const BLOCKED_HOSTNAME_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa"];

interface Ipv4Range {
  readonly base: readonly [number, number, number, number];
  readonly prefixLength: number;
}

// design.md §2, hostname rejections list.
const BLOCKED_IPV4_RANGES: readonly Ipv4Range[] = [
  { base: [127, 0, 0, 0], prefixLength: 8 }, // loopback
  { base: [10, 0, 0, 0], prefixLength: 8 }, // private
  { base: [172, 16, 0, 0], prefixLength: 12 }, // private
  { base: [192, 168, 0, 0], prefixLength: 16 }, // private
  { base: [169, 254, 0, 0], prefixLength: 16 }, // link-local, incl. 169.254.169.254
  { base: [0, 0, 0, 0], prefixLength: 8 }, // "this network"
  { base: [100, 64, 0, 0], prefixLength: 10 }, // carrier-grade NAT
];

const IPV4_LITERAL = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function ipv4ToInt(octets: readonly [number, number, number, number]): number {
  return (((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0);
}

function isIpv4Blocked(octets: readonly [number, number, number, number]): boolean {
  const value = ipv4ToInt(octets);
  return BLOCKED_IPV4_RANGES.some(({ base, prefixLength }) => {
    const mask = prefixLength === 0 ? 0 : (~0 << (32 - prefixLength)) >>> 0;
    return (value & mask) === (ipv4ToInt(base) & mask);
  });
}

function parseIpv4Literal(hostname: string): [number, number, number, number] | null {
  const match = IPV4_LITERAL.exec(hostname);
  if (!match) return null;
  const octets = match.slice(1, 5).map(Number);
  if (octets.some((octet) => octet > 255)) return null;
  return octets as [number, number, number, number];
}

/**
 * Expands a bracketed IPv6 literal, as returned by `URL#hostname` (already
 * lowercased and zero-compressed by the URL parser), into its eight 16-bit
 * groups. Returns null for anything that is not a well-formed literal.
 */
function parseIpv6Literal(hostname: string): number[] | null {
  if (!hostname.startsWith("[") || !hostname.endsWith("]")) return null;
  const body = hostname.slice(1, -1);

  const halves = body.split("::");
  if (halves.length > 2) return null;

  const toGroups = (segment: string): string[] => (segment.length === 0 ? [] : segment.split(":"));
  const head = toGroups(halves[0]);
  const tail = halves.length === 2 ? toGroups(halves[1]) : [];
  const groupCount = head.length + tail.length;

  if (halves.length === 1 && groupCount !== 8) return null;
  if (halves.length === 2 && groupCount >= 8) return null;

  const missing = halves.length === 2 ? 8 - groupCount : 0;
  const full = halves.length === 2 ? [...head, ...Array(missing).fill("0"), ...tail] : head;
  if (full.length !== 8) return null;

  const values: number[] = [];
  for (const group of full) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    values.push(parseInt(group, 16));
  }
  return values;
}

function isIpv6Blocked(groups: readonly number[]): boolean {
  const isZero = (value: number): boolean => value === 0;

  // ::1 — loopback
  if (groups.slice(0, 7).every(isZero) && groups[7] === 1) return true;
  // :: — unspecified
  if (groups.every(isZero)) return true;
  // fe80::/10 — link-local
  if ((groups[0] & 0xffc0) === 0xfe80) return true;
  // fc00::/7 — unique local
  if ((groups[0] & 0xfe00) === 0xfc00) return true;
  // ::ffff:a.b.c.d — IPv4-mapped; decode and re-check against the IPv4 ranges
  if (groups.slice(0, 4).every(isZero) && groups[4] === 0 && groups[5] === 0xffff) {
    const octets: [number, number, number, number] = [
      (groups[6] >> 8) & 0xff,
      groups[6] & 0xff,
      (groups[7] >> 8) & 0xff,
      groups[7] & 0xff,
    ];
    return isIpv4Blocked(octets);
  }
  return false;
}

function isBlockedHostnameLiteral(hostname: string): boolean {
  if (BLOCKED_HOSTNAME_EXACT.has(hostname)) return true;
  return BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
}

export function validateTargetUrl(rawUrl: string): TargetUrlGuardResult {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { allowed: false, reason: "unparseable", detail: `"${rawUrl}" is not a valid URL`, hostname: null };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return {
      allowed: false,
      reason: "unsupported_scheme",
      detail: `scheme "${url.protocol}" is not http: or https:`,
      hostname: url.hostname,
    };
  }

  if (url.username !== "" || url.password !== "") {
    return {
      allowed: false,
      reason: "embedded_credentials",
      detail: "URL must not carry embedded credentials",
      hostname: url.hostname,
    };
  }

  if (!ALLOWED_PORTS.has(url.port)) {
    return {
      allowed: false,
      reason: "disallowed_port",
      detail: `port "${url.port}" is not 80, 443, or the scheme default`,
      hostname: url.hostname,
    };
  }

  const hostname = url.hostname;

  if (hostname.startsWith("[")) {
    // Fail closed: an IPv6 literal this parser cannot expand is treated as
    // blocked rather than allowed, since its safety cannot be verified.
    const groups = parseIpv6Literal(hostname);
    if (!groups || isIpv6Blocked(groups)) {
      return {
        allowed: false,
        reason: "blocked_hostname",
        detail: `"${hostname}" is a non-routable or unrecognized IPv6 literal`,
        hostname,
      };
    }
    return { allowed: true, url };
  }

  const ipv4 = parseIpv4Literal(hostname);
  if (ipv4) {
    if (isIpv4Blocked(ipv4)) {
      return {
        allowed: false,
        reason: "blocked_hostname",
        detail: `"${hostname}" is a non-routable IPv4 address`,
        hostname,
      };
    }
    return { allowed: true, url };
  }

  if (isBlockedHostnameLiteral(hostname)) {
    return {
      allowed: false,
      reason: "blocked_hostname",
      detail: `"${hostname}" is a reserved local hostname`,
      hostname,
    };
  }

  if (!hostname.includes(".")) {
    return {
      allowed: false,
      reason: "blocked_hostname",
      detail: `"${hostname}" is a single-label hostname`,
      hostname,
    };
  }

  return { allowed: true, url };
}
