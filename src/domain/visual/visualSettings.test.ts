import { describe, expect, it } from "vitest";
import {
  DEFAULT_VISUAL_SETTINGS,
  VISUAL_SETTINGS_CONFIG_KEY,
  normalizeVisualSettings,
} from "./visualSettings";

describe("DEFAULT_VISUAL_SETTINGS", () => {
  it("deep-equals the first-run defaults", () => {
    expect(DEFAULT_VISUAL_SETTINGS).toEqual({
      theme: "auto",
      fontFamily: "system",
      fontSize: "base",
      navMode: "auto",
    });
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
    });
  });

  it("falls back each invalid field individually while valid siblings survive", () => {
    const settings = normalizeVisualSettings({
      theme: "neon",
      fontFamily: "system",
      fontSize: "lg",
      navMode: "scroll",
    });
    expect(settings).toEqual({
      theme: "auto",
      fontFamily: "system",
      fontSize: "lg",
      navMode: "auto",
    });
  });

  it("falls back every invalid value in a fully-invalid record", () => {
    expect(
      normalizeVisualSettings({ theme: "neon", fontFamily: "x", fontSize: "huge", navMode: "y" }),
    ).toEqual(DEFAULT_VISUAL_SETTINGS);
  });
});
