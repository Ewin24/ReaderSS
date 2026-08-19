import { describe, expect, it } from "vitest";
import { shortHash } from "./hash";

describe("shortHash", () => {
  it("is deterministic for the same input", () => {
    expect(shortHash("a")).toBe(shortHash("a"));
  });

  it("produces a 64-bit digest (16 hex chars) — collision space must be wide enough for a value that also serves as the entries object store's IndexedDB primary key (Finding 5: a collision there silently overwrites an unrelated article via putEntry's upsert)", () => {
    expect(shortHash("anything")).toMatch(/^[0-9a-f]{16}$/);
  });

  it("does not collapse many distinct identity sources to the same hash", () => {
    const hashes = new Set(Array.from({ length: 500 }, (_, i) => shortHash(`entry-${i}`)));

    expect(hashes.size).toBe(500);
  });
});
