import { describe, expect, it } from "vitest";
import { describeError } from "./describeError";

/**
 * The same three-line function was copied into eight files (`App.tsx`,
 * `EntryListContainer`,
 * `ReadingPaneContainer`, `FeedSidebarContainer`, `RefreshContainer`,
 * `AddFeedContainer`, `toggleEntryField.ts`, `bootstrap.tsx`), each a
 * separate chance to miss a future change (e.g. unwrapping a domain error,
 * redacting a field). Lives in `domain/` (design.md §1's dependency-free
 * innermost layer) so every other layer may import the one implementation.
 */
describe("describeError", () => {
  it("returns an Error's own message", () => {
    expect(describeError(new Error("boom"))).toBe("boom");
  });

  it("preserves a subclassed Error's message", () => {
    class CustomError extends Error {}
    expect(describeError(new CustomError("custom failure"))).toBe("custom failure");
  });

  it("stringifies a non-Error thrown string", () => {
    expect(describeError("a string failure")).toBe("a string failure");
  });

  it("stringifies a non-Error thrown number", () => {
    expect(describeError(42)).toBe("42");
  });

  it("stringifies null and undefined without throwing", () => {
    expect(describeError(null)).toBe("null");
    expect(describeError(undefined)).toBe("undefined");
  });

  it("stringifies a plain thrown object", () => {
    expect(describeError({ code: "E_FAIL" })).toBe("[object Object]");
  });
});
