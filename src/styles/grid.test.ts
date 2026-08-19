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
