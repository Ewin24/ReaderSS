/**
 * Enumerated visual settings for the reader front. Every field is a closed
 * union of named tokens (D1) rather than a free-form string: this lets the
 * persistence layer validate stored data per-field via
 * {@link normalizeVisualSettings} (invalid values fall back individually,
 * valid siblings survive), and guarantees no arbitrary string can ever be
 * injected into a CSS attribute selector through a setting.
 *
 * `theme` and `navMode` both default to `auto`, meaning "follow the system /
 * keep the existing behavior" rather than a fixed value.
 */
export interface VisualSettings {
  readonly theme: "light" | "dark" | "auto";
  readonly fontFamily: "system" | "serif" | "sans" | "mono";
  readonly fontSize: "sm" | "base" | "lg" | "xl";
  readonly navMode: "auto" | "paginated";
  /**
   * Design theme (flat/classic/clean), orthogonal to `theme` which picks the
   * color scheme WITHIN whichever design theme is active. `flat` is the base
   * design and needs no `data-visual` attribute; future themes set
   * `data-visual="classic"|"clean"` (see `src/styles/visual.css`).
   */
  readonly visualTheme: "flat" | "classic" | "clean";
}

export const THEME_OPTIONS = ["light", "dark", "auto"] as const;
export type Theme = (typeof THEME_OPTIONS)[number];

export const FONT_FAMILY_OPTIONS = ["system", "serif", "sans", "mono"] as const;
export type FontFamily = (typeof FONT_FAMILY_OPTIONS)[number];

export const FONT_SIZE_OPTIONS = ["sm", "base", "lg", "xl"] as const;
export type FontSize = (typeof FONT_SIZE_OPTIONS)[number];

export const NAV_MODE_OPTIONS = ["auto", "paginated"] as const;
export type NavMode = (typeof NAV_MODE_OPTIONS)[number];

export const VISUAL_THEME_OPTIONS = ["flat", "classic", "clean"] as const;
export type VisualTheme = (typeof VISUAL_THEME_OPTIONS)[number];

/** Human-readable labels for the design-theme control group (SettingsPanel). */
export const VISUAL_THEME_LABELS: Record<VisualTheme, string> = {
  flat: "Flat",
  classic: "Classic",
  clean: "Clean",
};

export const DEFAULT_VISUAL_SETTINGS: VisualSettings = {
  theme: "auto",
  fontFamily: "system",
  fontSize: "base",
  navMode: "auto",
  visualTheme: "flat",
};

/** Key under which the settings record is stored in the `config` store. */
export const VISUAL_SETTINGS_CONFIG_KEY = "visual";

function isTheme(value: unknown): value is VisualSettings["theme"] {
  return (THEME_OPTIONS as readonly unknown[]).includes(value);
}

function isFontFamily(value: unknown): value is VisualSettings["fontFamily"] {
  return (FONT_FAMILY_OPTIONS as readonly unknown[]).includes(value);
}

function isFontSize(value: unknown): value is VisualSettings["fontSize"] {
  return (FONT_SIZE_OPTIONS as readonly unknown[]).includes(value);
}

function isNavMode(value: unknown): value is VisualSettings["navMode"] {
  return (NAV_MODE_OPTIONS as readonly unknown[]).includes(value);
}

function isVisualTheme(value: unknown): value is VisualSettings["visualTheme"] {
  return (VISUAL_THEME_OPTIONS as readonly unknown[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validates an arbitrary persisted record per-field, falling back each
 * invalid or missing field to its default while keeping valid siblings.
 * Returns the full default set for any non-object input so a corrupt
 * `config/visual` record never crashes the reader or leaks an odd value.
 */
export function normalizeVisualSettings(raw: unknown): VisualSettings {
  if (!isRecord(raw)) {
    return { ...DEFAULT_VISUAL_SETTINGS };
  }
  return {
    theme: isTheme(raw.theme) ? raw.theme : DEFAULT_VISUAL_SETTINGS.theme,
    fontFamily: isFontFamily(raw.fontFamily)
      ? raw.fontFamily
      : DEFAULT_VISUAL_SETTINGS.fontFamily,
    fontSize: isFontSize(raw.fontSize) ? raw.fontSize : DEFAULT_VISUAL_SETTINGS.fontSize,
    navMode: isNavMode(raw.navMode) ? raw.navMode : DEFAULT_VISUAL_SETTINGS.navMode,
    visualTheme: isVisualTheme(raw.visualTheme)
      ? raw.visualTheme
      : DEFAULT_VISUAL_SETTINGS.visualTheme,
  };
}
