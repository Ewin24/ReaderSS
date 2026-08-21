import { describe, expect, it } from "vitest";
import type { VisualSettings } from "../domain/visual/visualSettings";
import { applyVisualSettings, resolveTheme } from "./theme";

describe("resolveTheme", () => {
  it("resolves auto + not dark → light", () => {
    expect(resolveTheme("auto", false)).toBe("light");
  });

  it("resolves auto + dark → dark", () => {
    expect(resolveTheme("auto", true)).toBe("dark");
  });

  it("manual light wins even when the system prefers dark", () => {
    expect(resolveTheme("light", true)).toBe("light");
  });

  it("manual dark wins even when the system prefers light", () => {
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("applyVisualSettings", () => {
  function fakeRoot(): HTMLElement {
    return document.createElement("html");
  }

  const fullSettings: VisualSettings = {
    theme: "dark",
    fontFamily: "serif",
    fontSize: "lg",
    navMode: "paginated",
    visualTheme: "classic",
  };

  it("sets data-theme, data-font and data-font-size attributes from settings", () => {
    const root = fakeRoot();
    applyVisualSettings(fullSettings, "dark", root);

    expect(root.dataset.theme).toBe("dark");
    expect(root.dataset.font).toBe("serif");
    expect(root.dataset.fontSize).toBe("lg");
    // The emitted attribute is `data-font-size` (the DOM dataset camelCases it).
    expect(root.getAttribute("data-font-size")).toBe("lg");
  });

  it("writes data-visual only when the design theme is not the default flat, and omits it for flat", () => {
    const root = fakeRoot();
    applyVisualSettings(fullSettings, "dark", root);
    expect(root.dataset.visual).toBe("classic");

    // flat is the base design theme: the attribute must be omitted entirely
    // (setOrRemove default-omission pattern), so no selector matches the base.
    applyVisualSettings({ ...fullSettings, visualTheme: "flat" }, "dark", root);
    expect(root.dataset.visual).toBeUndefined();
    expect(root.getAttribute("data-visual")).toBeNull();
  });

  it("removes a stale data-visual attribute when the design theme returns to flat", () => {
    const root = fakeRoot();
    applyVisualSettings(fullSettings, "dark", root);
    expect(root.dataset.visual).toBe("classic");

    applyVisualSettings({ ...fullSettings, theme: "auto", visualTheme: "flat" }, "light", root);
    expect(root.dataset.visual).toBeUndefined();
  });

  it("writes the resolved theme onto the element even when it differs from the stored preference", () => {
    const root = fakeRoot();
    // stored theme is auto, but the resolved (system) theme is dark.
    applyVisualSettings({ ...fullSettings, theme: "auto" }, "dark", root);

    expect(root.dataset.theme).toBe("dark");
  });

  it("removes a stale attribute when its value returns to the default", () => {
    const root = fakeRoot();
    // First apply a non-default font, then revert to the system default.
    applyVisualSettings(fullSettings, "dark", root);
    applyVisualSettings(
      { ...fullSettings, theme: "auto", fontFamily: "system", fontSize: "base" },
      "light",
      root,
    );

    expect(root.dataset.theme).toBe("light");
    expect(root.dataset.font).toBeUndefined();
    expect(root.dataset.fontSize).toBeUndefined();
  });
});
