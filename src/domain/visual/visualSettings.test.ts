import { describe, expect, it } from "vitest";
import {
  DEFAULT_VISUAL_SETTINGS,
  VISUAL_SETTINGS_CONFIG_KEY,
  VISUAL_THEME_LABELS,
  VISUAL_THEME_OPTIONS,
  normalizeVisualSettings,
} from "./visualSettings";

describe("DEFAULT_VISUAL_SETTINGS", () => {
  it("deep-equals the first-run defaults", () => {
    expect(DEFAULT_VISUAL_SETTINGS).toEqual({
      theme: "auto",
      fontFamily: "system",
      fontSize: "base",
      navMode: "auto",
      visualTheme: "flat",
    });
  });
});

describe("VISUAL_THEME_OPTIONS and VISUAL_THEME_LABELS", () => {
  it("offers the flat/classic/clean design themes in order", () => {
    expect(VISUAL_THEME_OPTIONS).toEqual(["flat", "classic", "clean"]);
  });

  it("labels every design theme for the settings UI", () => {
    for (const option of VISUAL_THEME_OPTIONS) {
      expect(VISUAL_THEME_LABELS[option]).toBeTruthy();
    }
    expect(VISUAL_THEME_LABELS.flat).toBe("Flat");
    expect(VISUAL_THEME_LABELS.classic).toBe("Classic");
    expect(VISUAL_THEME_LABELS.clean).toBe("Clean");
  });
});

describe("VISUAL_SETTINGS_CONFIG_KEY", () => {
  it("is the 'visual' config key", () => {
    expect(VISUAL_SETTINGS_CONFIG_KEY).toBe("visual");
  });
});

describe("normalizeVisualSettings", () => {
  it("returns a valid object unchanged", () => {
    const settings = {
      theme: "dark",
      fontFamily: "serif",
      fontSize: "lg",
      navMode: "paginated",
      visualTheme: "classic",
    };
    expect(normalizeVisualSettings(settings)).toEqual(settings);
  });

  it("returns defaults for undefined input", () => {
    expect(normalizeVisualSettings(undefined)).toEqual(DEFAULT_VISUAL_SETTINGS);
  });

  it("returns defaults for null input", () => {
    expect(normalizeVisualSettings(null)).toEqual(DEFAULT_VISUAL_SETTINGS);
  });

  it("returns defaults for non-object input", () => {
    expect(normalizeVisualSettings("dark")).toEqual(DEFAULT_VISUAL_SETTINGS);
    expect(normalizeVisualSettings(42)).toEqual(DEFAULT_VISUAL_SETTINGS);
  });

  it("fills missing fields from defaults while keeping a valid sibling", () => {
    const settings = normalizeVisualSettings({ theme: "dark" });
    expect(settings).toEqual({
      theme: "dark",
      fontFamily: "system",
      fontSize: "base",
      navMode: "auto",
      visualTheme: "flat",
    });
  });

  it("falls back an invalid visualTheme to 'flat' while valid siblings survive", () => {
    const settings = normalizeVisualSettings({
      theme: "dark",
      fontFamily: "serif",
      fontSize: "lg",
      navMode: "paginated",
      visualTheme: "neon",
    });
    expect(settings).toEqual({
      theme: "dark",
      fontFamily: "serif",
      fontSize: "lg",
      navMode: "paginated",
      visualTheme: "flat",
    });
  });

  it("keeps a valid non-default visualTheme", () => {
    const settings = normalizeVisualSettings({ visualTheme: "clean" });
    expect(settings.visualTheme).toBe("clean");
  });

  it("falls back each invalid field individually while valid siblings survive", () => {
    const settings = normalizeVisualSettings({
      theme: "neon",
      fontFamily: "system",
      fontSize: "lg",
      navMode: "scroll",
      visualTheme: "flat",
    });
    expect(settings).toEqual({
      theme: "auto",
      fontFamily: "system",
      fontSize: "lg",
      navMode: "auto",
      visualTheme: "flat",
    });
  });

  it("falls back every invalid value in a fully-invalid record", () => {
    expect(
      normalizeVisualSettings({ theme: "neon", fontFamily: "x", fontSize: "huge", navMode: "y" }),
    ).toEqual(DEFAULT_VISUAL_SETTINGS);
  });
});
