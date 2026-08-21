/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REQUIRED_COLOR_TOKENS = [
  "--color-bg",
  "--color-surface",
  "--color-text",
  "--color-text-muted",
  "--color-accent",
  "--color-border",
];

describe("visual.css token definitions", () => {
  const cssPath = resolve(process.cwd(), "src/styles/visual.css");
  const css = readFileSync(cssPath, "utf-8");

  function extractBlock(source: string, selector: string): string {
    const escapedSelector = selector.replace(/[[\]"]/g, "\\$&");
    const regex = new RegExp(`${escapedSelector}\\s*\\{([^}]+)\\}`, "m");
    const match = source.match(regex);
    if (!match) {
      throw new Error(`Expected rule for "${selector}" in visual.css`);
    }
    return match[1];
  }

  it("defines base flat theme tokens in :root", () => {
    const block = extractBlock(css, ":root");
    for (const token of REQUIRED_COLOR_TOKENS) {
      expect(block).toContain(token);
    }
    expect(block).toContain("--font-family");
    expect(block).toContain("--font-size-base");
  });

  it("defines dark mode overrides in html[data-theme=\"dark\"]", () => {
    const block = extractBlock(css, 'html[data-theme="dark"]');
    for (const token of REQUIRED_COLOR_TOKENS) {
      expect(block).toContain(token);
    }
  });

  it("defines classic theme light tokens in html[data-visual=\"classic\"]", () => {
    const block = extractBlock(css, 'html[data-visual="classic"]');
    for (const token of REQUIRED_COLOR_TOKENS) {
      expect(block).toContain(token);
    }
  });

  it("defines classic theme dark tokens in html[data-visual=\"classic\"][data-theme=\"dark\"]", () => {
    const block = extractBlock(css, 'html[data-visual="classic"][data-theme="dark"]');
    for (const token of REQUIRED_COLOR_TOKENS) {
      expect(block).toContain(token);
    }
  });

  it("defines clean theme light tokens in html[data-visual=\"clean\"]", () => {
    const block = extractBlock(css, 'html[data-visual="clean"]');
    for (const token of REQUIRED_COLOR_TOKENS) {
      expect(block).toContain(token);
    }
  });

  it("defines clean theme dark tokens in html[data-visual=\"clean\"][data-theme=\"dark\"]", () => {
    const block = extractBlock(css, 'html[data-visual="clean"][data-theme="dark"]');
    for (const token of REQUIRED_COLOR_TOKENS) {
      expect(block).toContain(token);
    }
  });

  it("defines all font family selector blocks", () => {
    expect(extractBlock(css, 'html[data-font="serif"]')).toContain("--font-family");
    expect(extractBlock(css, 'html[data-font="sans"]')).toContain("--font-family");
    expect(extractBlock(css, 'html[data-font="mono"]')).toContain("--font-family");
  });

  it("defines all font size selector blocks", () => {
    expect(extractBlock(css, 'html[data-font-size="sm"]')).toContain("--font-size-base");
    expect(extractBlock(css, 'html[data-font-size="lg"]')).toContain("--font-size-base");
    expect(extractBlock(css, 'html[data-font-size="xl"]')).toContain("--font-size-base");
  });
});
