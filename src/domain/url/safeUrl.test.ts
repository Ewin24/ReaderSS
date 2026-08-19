import { describe, expect, it } from "vitest";
import { toSafeHref } from "./safeUrl";

describe("toSafeHref", () => {
  it("accepts an https URL", () => {
    expect(toSafeHref("https://example.com/article")).toBe(
      "https://example.com/article",
    );
  });

  it("accepts an http URL", () => {
    expect(toSafeHref("http://example.com/article")).toBe(
      "http://example.com/article",
    );
  });

  it("rejects a javascript: URL", () => {
    expect(toSafeHref("javascript:alert(1)")).toBeNull();
  });

  it("rejects a data: URL", () => {
    expect(toSafeHref("data:text/html,<script>alert(1)</script>")).toBeNull();
  });

  it("rejects a vbscript: URL", () => {
    expect(toSafeHref("vbscript:msgbox(1)")).toBeNull();
  });

  it("rejects a malformed, non-absolute value", () => {
    expect(toSafeHref("not a url")).toBeNull();
  });

  it("rejects an empty or non-string value", () => {
    expect(toSafeHref("")).toBeNull();
    expect(toSafeHref(undefined as unknown as string)).toBeNull();
  });
});
