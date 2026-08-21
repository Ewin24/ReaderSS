/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DESKTOP_BREAKPOINT_PX } from "../app/useMediaQuery";

// grid.css is plain CSS and cannot import a JS constant, so it cannot share
// a single runtime value with useMediaQuery's DESKTOP_BREAKPOINT_PX (the
// one place the pixel number is defined in application code). This test is
// the enforcement mechanism that keeps the two literals in sync: if a later
// change widens/narrows the CSS breakpoint without updating the JS constant
// (or vice versa), this test fails immediately.
//
// Reads the file directly via Node's fs rather than a Vite `?raw`/`?inline`
// import: both were tried and returned an empty string here, because
// Vitest runs modules through Vite's SSR transform pipeline, where the CSS
// plugin does not process file content the same way it does for a client
// build. `node:fs`/`node:path` require @types/node, which tsconfig.app.json
// deliberately does NOT auto-include (browser code must not see Node
// globals) - hence the explicit `/// <reference types="node" />` opt-in
// scoped to this one Node-only test file.
describe("grid.css breakpoint consistency", () => {
  it("uses the same desktop breakpoint pixel value as useMediaQuery's DESKTOP_BREAKPOINT_PX", () => {
    const cssPath = resolve(process.cwd(), "src/styles/grid.css");
    const css = readFileSync(cssPath, "utf-8");
    const match = css.match(/@media\s*\(min-width:\s*(\d+)px\)/);

    expect(match).not.toBeNull();
    expect(Number(match?.[1])).toBe(DESKTOP_BREAKPOINT_PX);
  });
});

/**
 * Guard against the "off-screen reading pane" defect found by real use: the
 * actions bar (`.app-shell__actions`) was added as a direct child
 * of `.app-shell` with no grid placement rule of its own. With no rule, it
 * silently fell into the implicit grid ahead of the three panes at the
 * desktop breakpoint, pushing every pane one column to the right and the
 * reading pane below the fold in a 220px-wide column -- rendered correctly,
 * just never visible. `App.tsx`'s toggle-error banner has the same shape of
 * risk: it is also a conditionally rendered, non-pane direct child.
 *
 * WHAT THIS TEST CATCHES: any `.app-shell` direct child class listed in
 * `KNOWN_NON_PANE_CHILD_CLASSES` below that does NOT have an explicit,
 * full-width (spanning every column) grid placement at the desktop
 * (`min-width: 768px`) breakpoint. It is a targeted regression guard for
 * this exact defect shape, not general layout coverage.
 *
 * WHAT THIS TEST DOES NOT CATCH:
 * - jsdom performs no layout (the same limitation the breakpoint test above
 *   documents), so this cannot confirm pixels actually render correctly on
 *   screen -- only that the CSS rules exist and are structurally
 *   consistent with each other. It is a structural proxy for layout, not a
 *   layout test, and pretending otherwise would repeat this project's
 *   standing defect pattern (asserting a property the code/test does not
 *   actually have).
 * - It does not check the mobile (<768px) single-column stack: with one
 *   grid column, any child is trivially "full width" there by
 *   construction, so there is nothing breakpoint-specific to assert.
 * - `KNOWN_NON_PANE_CHILD_CLASSES` is a manually maintained list, NOT
 *   derived from `App.tsx`. Deriving it would require parsing `App.tsx`'s
 *   JSX rather than reading CSS text, which was judged too fragile for a
 *   test whose whole point is to be a simple, trustworthy backstop.
 *   Adding a new non-pane child to `App.tsx` (an offline banner, an update
 *   prompt, a first-run setup screen -- all anticipated future additions)
 *   WILL NOT be caught by this test unless that child's class is also
 *   added to this list. Whoever adds such a child MUST update grid.css's
 *   grid-template-areas (both breakpoints), give the new class its own
 *   `grid-area` rule, and add its class name here -- in that order, so the
 *   RED failure below proves the omission before the fix lands.
 */
describe("grid.css: non-pane app-shell children get explicit full-width placement", () => {
  const cssPath = resolve(process.cwd(), "src/styles/grid.css");
  const css = readFileSync(cssPath, "utf-8");

  // The three presentational panes. These intentionally do NOT span the
  // full width -- they are the columns the layout is built around -- so
  // they are excluded from the full-width check below.
  const PANE_CLASSES = ["feed-sidebar", "entry-list", "reading-pane"];

  // Every other class `App.tsx` renders as a DIRECT child of `.app-shell`,
  // as of this fix (see the file-level comment above for the maintenance
  // contract on this list).
  const KNOWN_NON_PANE_CHILD_CLASSES = [
    "app-shell__toggle-error",
    "app-shell__actions",
    "app-shell__settings",
  ];

  function extractDesktopBlock(source: string): string {
    const mediaStart = source.indexOf("@media");
    if (mediaStart === -1) {
      throw new Error("Expected an @media (min-width) block in grid.css");
    }
    const braceStart = source.indexOf("{", mediaStart);
    let depth = 0;
    let i = braceStart;
    for (; i < source.length; i += 1) {
      if (source[i] === "{") depth += 1;
      else if (source[i] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    return source.slice(braceStart + 1, i);
  }

  function extractDeclaration(source: string, selector: string, property: string): string {
    const selectorPattern = new RegExp(`${selector}\\s*\\{([^}]*)\\}`);
    const ruleMatch = source.match(selectorPattern);
    if (!ruleMatch) {
      throw new Error(`Expected a "${selector}" rule in grid.css`);
    }
    const propertyPattern = new RegExp(`${property}:\\s*([^;]+);`);
    const propertyMatch = ruleMatch[1].match(propertyPattern);
    if (!propertyMatch) {
      throw new Error(`Expected "${property}" inside the "${selector}" rule in grid.css`);
    }
    return propertyMatch[1].trim();
  }

  function getDesktopGridInfo() {
    const desktopBlock = extractDesktopBlock(css);
    const columnCount = extractDeclaration(desktopBlock, "\\.app-shell", "grid-template-columns")
      .split(/\s+/)
      .filter(Boolean).length;
    const areasDeclaration = extractDeclaration(
      desktopBlock,
      "\\.app-shell",
      "grid-template-areas",
    );
    const areaRows = [...areasDeclaration.matchAll(/"([^"]*)"/g)].map((match) =>
      match[1].trim(),
    );
    return { columnCount, areaRows };
  }

  it.each(KNOWN_NON_PANE_CHILD_CLASSES)(
    "gives .%s an explicit, full-width grid placement at the desktop breakpoint",
    (className) => {
      const { columnCount, areaRows } = getDesktopGridInfo();
      const areaName = extractDeclaration(css, `\\.${className}`, "grid-area");

      const ownRow = areaRows.find((row) => row.split(/\s+/).includes(areaName));
      expect(
        ownRow,
        `Expected a "${areaName}" area somewhere in grid.css's desktop grid-template-areas`,
      ).toBeDefined();

      const tokens = (ownRow ?? "").split(/\s+/).filter(Boolean);
      expect(
        tokens.every((token) => token === areaName),
        `Expected every column in .${className}'s row to be "${areaName}" (full width), got: "${ownRow}"`,
      ).toBe(true);
      expect(
        tokens.length,
        `Expected .${className}'s row to span all ${columnCount} grid columns`,
      ).toBe(columnCount);
    },
  );

  it("keeps the pane classes out of the non-pane list (list sanity check)", () => {
    for (const paneClass of PANE_CLASSES) {
      expect(KNOWN_NON_PANE_CHILD_CLASSES).not.toContain(paneClass);
    }
  });
});
