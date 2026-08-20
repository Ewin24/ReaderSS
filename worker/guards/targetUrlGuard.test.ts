import { describe, expect, test } from "vitest";
import { validateTargetUrl } from "./targetUrlGuard";

/**
 * One test per threat-matrix class (abuse: an open fetch relay is an open
 * proxy). Each rejection asserts BOTH
 * `allowed: false` and the specific `reason` code, so a test cannot pass by
 * accident on a guard that rejects everything.
 */
describe("validateTargetUrl — rejects disallowed schemes", () => {
  test.each(["file:///etc/passwd", "data:text/plain;base64,aGVsbG8=", "gopher://example.com/", "ftp://example.com/"])(
    "rejects %s as unsupported_scheme",
    (raw) => {
      const result = validateTargetUrl(raw);
      expect(result.allowed).toBe(false);
      if (!result.allowed) expect(result.reason).toBe("unsupported_scheme");
    },
  );
});

describe("validateTargetUrl — rejects unparseable input", () => {
  test.each(["not a url", "", "http://", "http://[::1"])("rejects %s as unparseable", (raw) => {
    const result = validateTargetUrl(raw);
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe("unparseable");
  });
});

describe("validateTargetUrl — rejects embedded credentials", () => {
  test("rejects http://user:pw@host/", () => {
    const result = validateTargetUrl("http://user:pw@example.com/feed.xml");
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe("embedded_credentials");
  });

  test("rejects a username with no password", () => {
    const result = validateTargetUrl("http://attacker@example.com/feed.xml");
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe("embedded_credentials");
  });
});

describe("validateTargetUrl — rejects non-80/443 ports", () => {
  test.each(["http://example.com:8080/", "https://example.com:8443/", "http://example.com:22/"])(
    "rejects %s as disallowed_port",
    (raw) => {
      const result = validateTargetUrl(raw);
      expect(result.allowed).toBe(false);
      if (!result.allowed) expect(result.reason).toBe("disallowed_port");
    },
  );

  test("allows an explicit default port (http:80)", () => {
    const result = validateTargetUrl("http://example.com:80/feed.xml");
    expect(result.allowed).toBe(true);
  });

  test("allows an explicit default port (https:443)", () => {
    const result = validateTargetUrl("https://example.com:443/feed.xml");
    expect(result.allowed).toBe(true);
  });
});

describe("validateTargetUrl — rejects loopback", () => {
  test.each(["http://127.0.0.1/", "http://127.255.255.254/", "http://[::1]/"])(
    "rejects %s as blocked_hostname",
    (raw) => {
      const result = validateTargetUrl(raw);
      expect(result.allowed).toBe(false);
      if (!result.allowed) expect(result.reason).toBe("blocked_hostname");
    },
  );
});

describe("validateTargetUrl — rejects private IPv4 ranges", () => {
  test.each([
    "http://10.0.0.1/",
    "http://10.255.255.255/",
    "http://172.16.0.1/",
    "http://172.31.255.255/",
    "http://192.168.0.1/",
    "http://192.168.255.255/",
    "http://100.64.0.1/",
    "http://100.127.255.255/",
    "http://0.0.0.1/",
  ])("rejects %s as blocked_hostname", (raw) => {
    const result = validateTargetUrl(raw);
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe("blocked_hostname");
  });

  test("boundary check: 172.15.255.255 (just outside 172.16.0.0/12) is allowed", () => {
    const result = validateTargetUrl("http://172.15.255.255/");
    expect(result.allowed).toBe(true);
  });

  test("boundary check: 172.32.0.0 (just outside 172.16.0.0/12) is allowed", () => {
    const result = validateTargetUrl("http://172.32.0.0/");
    expect(result.allowed).toBe(true);
  });
});

describe("validateTargetUrl — rejects link-local IPv4, including the cloud metadata address", () => {
  test.each(["http://169.254.169.254/", "http://169.254.0.1/", "http://169.254.255.254/"])(
    "rejects %s as blocked_hostname",
    (raw) => {
      const result = validateTargetUrl(raw);
      expect(result.allowed).toBe(false);
      if (!result.allowed) expect(result.reason).toBe("blocked_hostname");
    },
  );
});

describe("validateTargetUrl — rejects decimal/octal/hex IP-literal encodings of a blocked address", () => {
  test.each([
    "http://2130706433/", // decimal for 127.0.0.1
    "http://0x7f000001/", // hex for 127.0.0.1
    "http://017700000001/", // octal for 127.0.0.1
    "http://0x7f.0x0.0x0.0x1/", // mixed hex-octet
    "http://0177.0.0.1/", // octal first octet
    "http://127.1/", // shorthand (implied middle zeros)
  ])("rejects %s (normalizes to a loopback address) as blocked_hostname", (raw) => {
    const result = validateTargetUrl(raw);
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe("blocked_hostname");
  });
});

describe("validateTargetUrl — rejects IPv6 forms", () => {
  test("rejects the unspecified address ::", () => {
    const result = validateTargetUrl("http://[::]/");
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe("blocked_hostname");
  });

  test("rejects link-local fe80::/10", () => {
    const result = validateTargetUrl("http://[fe80::1]/");
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe("blocked_hostname");
  });

  test("rejects the fe80::/10 upper boundary [febf:ffff::1]", () => {
    const result = validateTargetUrl("http://[febf:ffff::1]/");
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe("blocked_hostname");
  });

  test("rejects unique-local fc00::/7", () => {
    const result = validateTargetUrl("http://[fc00::1]/");
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe("blocked_hostname");
  });

  test("rejects the fc00::/7 upper boundary [fdff:ffff::1]", () => {
    const result = validateTargetUrl("http://[fdff:ffff::1]/");
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe("blocked_hostname");
  });

  test("rejects an IPv4-mapped loopback ::ffff:127.0.0.1", () => {
    const result = validateTargetUrl("http://[::ffff:127.0.0.1]/");
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe("blocked_hostname");
  });

  test("rejects an IPv4-mapped link-local ::ffff:169.254.169.254", () => {
    const result = validateTargetUrl("http://[::ffff:169.254.169.254]/");
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe("blocked_hostname");
  });

  test("allows a public IPv6 literal", () => {
    const result = validateTargetUrl("https://[2001:4860:4860::8888]/");
    expect(result.allowed).toBe(true);
  });
});

describe("validateTargetUrl — rejects reserved local hostnames", () => {
  test.each([
    "http://localhost/feed.xml",
    "http://evil.localhost/",
    "http://foo.local/",
    "http://foo.internal/",
    "http://foo.home.arpa/",
    "http://internalhost/", // single-label, no dot
  ])("rejects %s as blocked_hostname", (raw) => {
    const result = validateTargetUrl(raw);
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe("blocked_hostname");
  });

  test("does not block a public domain that merely contains 'localhost' as a label prefix", () => {
    const result = validateTargetUrl("http://localhost.evil.example/");
    expect(result.allowed).toBe(true);
  });
});

describe("validateTargetUrl — a domain host ending in an all-numeric label is rejected by URL parsing itself", () => {
  test("http://a.1/ throws inside new URL() (WHATWG 'ends in a number' rule) and surfaces as unparseable", () => {
    // This documents, rather than re-implements, browser/Workers URL-parser
    // behavior: the WHATWG URL Standard's host parser rejects any domain
    // whose last label is all-digits unless the whole host is a valid IPv4
    // address. The guard adds no separate check for this case because none
    // is reachable — new URL() already throws before validateTargetUrl's
    // own logic runs.
    const result = validateTargetUrl("http://a.1/");
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toBe("unparseable");
  });
});

describe("validateTargetUrl — legitimate public feed URLs pass", () => {
  test.each([
    "https://example.com/feed.xml",
    "http://example.com/feed.xml",
    "https://blog.example.com:443/rss/",
    "https://192.0.2.10/feed.xml", // TEST-NET-1, public-range documentation address
    "https://8.8.8.8/feed.xml",
  ])("allows %s", (raw) => {
    const result = validateTargetUrl(raw);
    expect(result.allowed).toBe(true);
  });
});
