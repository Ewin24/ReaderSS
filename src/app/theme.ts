/**
 * Resolving and applying the active theme/font tokens to the document
 * element. This is the ONLY place the DOM is touched for visual settings
 * (D3 — services never touch the DOM, keeping them jsdom-independent and
 * pure).
 *
 * Application uses data-attributes only (D4): `documentElement.dataset.*`
 * sets `data-theme` / `data-font` / `data-font-size`, which the CSS
 * attribute selectors in `visual.css` read. No inline styles are written —
 * the app's CSP `style-src 'self'` forbids them.
 */
import type { VisualSettings } from "../domain/visual/visualSettings";

/** Resolves the effective light/dark theme from the stored preference. */
export function resolveTheme(theme: VisualSettings["theme"], prefersDark: boolean): "light" | "dark" {
  if (theme === "auto") {
    return prefersDark ? "dark" : "light";
  }
  return theme;
}

/** Default token values that need no explicit attribute (the CSS base already applies them). */
const DEFAULT_FONT_FAMILY = "system";
const DEFAULT_FONT_SIZE = "base";
/** `flat` is the base design theme; its token block lives in `:root` and needs no attribute. */
const DEFAULT_VISUAL_THEME = "flat";

function setOrRemove(root: HTMLElement, key: string, value: string | undefined): void {
  if (value === undefined) {
    delete root.dataset[key];
  } else {
    root.dataset[key] = value;
  }
}

/**
 * Applies the resolved theme plus the font-family/font-size tokens onto
 * `root` (the caller passes `document.documentElement`). The theme is always
 * written as the resolved light/dark value; font tokens are only written when
 * they differ from their base default, and a stale attribute is removed when
 * the value returns to the default.
 */
export function applyVisualSettings(
  settings: VisualSettings,
  resolved: "light" | "dark",
  root: HTMLElement,
): void {
  root.dataset.theme = resolved;
  setOrRemove(root, "font", settings.fontFamily === DEFAULT_FONT_FAMILY ? undefined : settings.fontFamily);
  setOrRemove(root, "fontSize", settings.fontSize === DEFAULT_FONT_SIZE ? undefined : settings.fontSize);
  setOrRemove(
    root,
    "visual",
    settings.visualTheme === DEFAULT_VISUAL_THEME ? undefined : settings.visualTheme,
  );
}
