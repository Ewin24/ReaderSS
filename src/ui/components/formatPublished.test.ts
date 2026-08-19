import { describe, expect, it } from "vitest";
import { formatPublished } from "./formatPublished";

describe("formatPublished", () => {
  it("formats a well-formed ISO date string to its date-only portion", () => {
    expect(formatPublished("2026-08-19T09:00:00.000Z")).toBe("2026-08-19");
  });

  it("returns an honest fallback for an empty string instead of throwing", () => {
    expect(formatPublished("")).toBe("Unknown date");
  });

  it("returns an honest fallback for a non-ISO, unparseable string instead of throwing", () => {
    expect(formatPublished("not-a-date")).toBe("Unknown date");
  });

  it("returns an honest fallback for non-string input instead of throwing", () => {
    // Real feed data is untyped at the network boundary; AppEntry.publishedAt's
    // non-nullable TypeScript type is a compile-time contract that upstream
    // parsing (slices 4-9) can still violate at runtime.
    expect(formatPublished(null as unknown as string)).toBe("Unknown date");
    expect(formatPublished(undefined as unknown as string)).toBe("Unknown date");
  });

  it("never renders the literal 'Invalid Date' for malformed input", () => {
    expect(formatPublished("garbage")).not.toMatch(/invalid date/i);
  });
});
