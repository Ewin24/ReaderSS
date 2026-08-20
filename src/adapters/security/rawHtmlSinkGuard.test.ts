import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Layer 3 of 3 for the single enforced DOMPurify choke point (design.md
 * §5). Layers 1 and 2 are `eslint.config.js`'s `no-restricted-syntax` and
 * `no-restricted-imports` rules; both can be silenced by an
 * `eslint-disable` comment. This test scans the actual PRODUCTION source
 * tree on disk and fails if either pattern shows up anywhere it should not,
 * or if an eslint-disable comment names either banned rule -- independent
 * of whether ESLint itself was run or its output was ignored.
 *
 * Scope, stated precisely: this scans `src/**`, `worker/**`, and
 * `shared/**` production files (`.ts`/`.tsx`, excluding `*.test.ts(x)`).
 * Test files are excluded deliberately: they legitimately reference these
 * patterns as plain strings (adversarial payload fixtures, this file's own
 * pattern constants) and legitimately read `.innerHTML`/`.outerHTML` for
 * RTL assertions, neither of which is the DOM-insertion sink this guard
 * protects against. That is a real, disclosed scope boundary, not an
 * oversight -- a raw-HTML sink written only inside a test file can never
 * reach a real user's DOM.
 *
 * Sink coverage: beyond the original four sinks
 * (`dangerouslySetInnerHTML`, `.innerHTML`, `.outerHTML`,
 * `insertAdjacentHTML`), this also flags `document.write(`,
 * `.parseFromString(` (DOMParser), `.createContextualFragment(` (Range),
 * `.setHTMLUnsafe(`, and `.srcdoc` -- and, for every property-name sink
 * above, its computed bracket-access form with a literal string key (e.g.
 * `el["innerHTML"]`), closing a gap in the original regex and the ESLint
 * `MemberExpression[property.name=...]` selectors, which both only match
 * non-computed dot-property access.
 *
 * KNOWN, DELIBERATE, UNCOVERED GAP: a computed bracket access built from a
 * STRING-CONCATENATION-OBFUSCATED key, e.g.
 * `el["inner" + "HTML"]`, is NOT detected by this regex, and cannot be
 * expressed as an ESLint AST selector matching a literal `property.value`
 * either, because the property is a `BinaryExpression`, not a `Literal`, at
 * parse time. No pattern-matching enforcement layer (regex or ESLint
 * selector) can close this without full data-flow/constant-folding
 * analysis, which is out of scope for all three layers here. This is
 * disclosed explicitly rather than described as closed: the three layers
 * substantially narrow, but do not eliminate, the raw-HTML-sink surface.
 */

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const SCAN_ROOTS = ["src", "worker", "shared"];
const IGNORED_DIR_NAMES = new Set(["node_modules", "dist", ".wrangler", "coverage"]);
const SCANNABLE_EXTENSIONS = [".ts", ".tsx"];

const RAW_HTML_SINK_ALLOWED_FILE = join("src", "ui", "components", "SafeHtml", "SafeHtml.tsx");
const DOMPURIFY_ALLOWED_DIR = join("src", "adapters", "security") + "\\";
const DOMPURIFY_ALLOWED_DIR_POSIX = "src/adapters/security/";

// Property-name sinks matched both as plain dot-property access AND as
// computed bracket access with a literal string key (the covered
// half of the blind spot -- see the module doc comment above for the
// deliberately uncovered, string-concatenation-obfuscated half).
const PROPERTY_SINK_NAMES = ["innerHTML", "outerHTML", "srcdoc"] as const;
const propertySinkAlternation = PROPERTY_SINK_NAMES.join("|");

export const RAW_HTML_SINK_PATTERN = new RegExp(
  [
    "dangerouslySetInnerHTML",
    `\\.(?:${propertySinkAlternation})\\b`,
    "insertAdjacentHTML\\s*\\(",
    "document\\.write\\s*\\(",
    "\\.parseFromString\\s*\\(",
    "\\.createContextualFragment\\s*\\(",
    "\\.setHTMLUnsafe\\s*\\(",
    // Computed bracket access with a literal string key, e.g.
    // `el["innerHTML"]` or `el['insertAdjacentHTML']` -- either quote style,
    // any of the property-name sinks above, or `insertAdjacentHTML` itself
    // (which is a method, not a property, but is still reachable this way:
    // `el["insertAdjacentHTML"](...)`).
    `\\[\\s*["'](?:${propertySinkAlternation}|insertAdjacentHTML)["']\\s*\\]`,
  ].join("|"),
);
const DOMPURIFY_IMPORT_PATTERN = /from\s+["']dompurify["']|require\(\s*["']dompurify["']\s*\)/;
const ESLINT_DISABLE_BANNED_RULE_PATTERN = /eslint-disable[^\n]*\b(no-restricted-syntax|no-restricted-imports)\b/;

function isTestFile(fileName: string): boolean {
  return fileName.endsWith(".test.ts") || fileName.endsWith(".test.tsx");
}

function listProductionSourceFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (IGNORED_DIR_NAMES.has(entry)) continue;
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      results.push(...listProductionSourceFiles(fullPath));
      continue;
    }
    if (SCANNABLE_EXTENSIONS.some((ext) => entry.endsWith(ext)) && !isTestFile(entry)) {
      results.push(fullPath);
    }
  }
  return results;
}

function isUnderDompurifyAllowedDir(relativePath: string): boolean {
  const posixPath = relativePath.split("\\").join("/");
  return relativePath.startsWith(DOMPURIFY_ALLOWED_DIR) || posixPath.startsWith(DOMPURIFY_ALLOWED_DIR_POSIX);
}

describe("raw HTML sink guard (design.md §5, enforcement layer 3 of 3)", () => {
  const files = SCAN_ROOTS.flatMap((root) => listProductionSourceFiles(join(REPO_ROOT, root)));

  it("scans a non-trivial number of production files (sanity check the scan itself is not vacuous)", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it("no file outside SafeHtml.tsx assigns dangerouslySetInnerHTML/.innerHTML/.outerHTML/insertAdjacentHTML", () => {
    const violations = files
      .filter((file) => relative(REPO_ROOT, file) !== RAW_HTML_SINK_ALLOWED_FILE)
      .filter((file) => RAW_HTML_SINK_PATTERN.test(readFileSync(file, "utf8")))
      .map((file) => relative(REPO_ROOT, file));

    expect(violations, `raw HTML sink found outside ${RAW_HTML_SINK_ALLOWED_FILE}: ${violations.join(", ")}`).toEqual(
      [],
    );
  });

  it("SafeHtml.tsx itself does still contain the one allowed sink (the guard is not vacuously passing)", () => {
    const content = readFileSync(join(REPO_ROOT, RAW_HTML_SINK_ALLOWED_FILE), "utf8");
    expect(RAW_HTML_SINK_PATTERN.test(content)).toBe(true);
  });

  it("no file outside src/adapters/security/** imports dompurify", () => {
    const violations = files
      .filter((file) => !isUnderDompurifyAllowedDir(relative(REPO_ROOT, file)))
      .filter((file) => DOMPURIFY_IMPORT_PATTERN.test(readFileSync(file, "utf8")))
      .map((file) => relative(REPO_ROOT, file));

    expect(violations, `dompurify imported outside src/adapters/security/**: ${violations.join(", ")}`).toEqual([]);
  });

  it("src/adapters/security/** does still import dompurify (the guard is not vacuously passing)", () => {
    const content = readFileSync(join(REPO_ROOT, "src", "adapters", "security", "domPurifySanitizer.ts"), "utf8");
    expect(DOMPURIFY_IMPORT_PATTERN.test(content)).toBe(true);
  });

  it("no eslint-disable comment silences no-restricted-syntax or no-restricted-imports anywhere in production source", () => {
    const violations = files
      .filter((file) => ESLINT_DISABLE_BANNED_RULE_PATTERN.test(readFileSync(file, "utf8")))
      .map((file) => relative(REPO_ROOT, file));

    expect(
      violations,
      `an eslint-disable comment names a banned rule in: ${violations.join(", ")}`,
    ).toEqual([]);
  });
});

describe("RAW_HTML_SINK_PATTERN coverage", () => {
  it.each([
    ["document.write(", 'document.write("<img onerror=alert(1)>");'],
    ["DOMParser#parseFromString(", 'new DOMParser().parseFromString(html, "text/html");'],
    ["Range#createContextualFragment(", "range.createContextualFragment(untrustedHtml);"],
    ["Element#setHTMLUnsafe(", "el.setHTMLUnsafe(untrustedHtml);"],
    ["iframe .srcdoc assignment", "frame.srcdoc = untrustedHtml;"],
  ])("flags the newly covered sink: %s", (_label, snippet) => {
    expect(RAW_HTML_SINK_PATTERN.test(snippet)).toBe(true);
  });

  it.each([
    ['el["innerHTML"] = untrustedHtml;', true],
    ["el['outerHTML'] = untrustedHtml;", true],
    ['el["insertAdjacentHTML"](position, untrustedHtml);', true],
    ['frame["srcdoc"] = untrustedHtml;', true],
  ])("flags computed bracket access with a literal string key: %s", (snippet, expected) => {
    expect(RAW_HTML_SINK_PATTERN.test(snippet)).toBe(expected);
  });

  it("does NOT flag computed bracket access built from string concatenation (documented, deliberate residual gap)", () => {
    // This is the specific case the module doc comment above names as
    // uncoverable by a static regex (or by an ESLint AST selector matching
    // a literal `property.value`): the key is assembled at runtime, so no
    // literal "innerHTML" substring ever appears in the source text for a
    // regex to match, and the AST node is a BinaryExpression, not a
    // Literal, for an AST selector to match either. Asserted here, rather
    // than left as an unverified claim, so the boundary is test-proven, not
    // just documented.
    const snippet = 'el["inner" + "HTML"] = untrustedHtml;';
    expect(RAW_HTML_SINK_PATTERN.test(snippet)).toBe(false);
  });

  it("still does not flag ordinary, unrelated computed bracket access", () => {
    expect(RAW_HTML_SINK_PATTERN.test('el["textContent"] = safeText;')).toBe(false);
    expect(RAW_HTML_SINK_PATTERN.test("record[dynamicKey] = value;")).toBe(false);
  });
});
