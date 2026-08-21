/**
 * Settings context: owns the loaded visual settings, applies them to the
 * document (via `applyVisualSettings` from `src/app/theme.ts`), and persists
 * every change to `config/visual`.
 *
 * - Loads persisted settings on mount (defaults when absent/corrupt).
 * - `updateSettings(patch)` merges optimistically, persists immediately, and
 *   marks `saveError` (non-blocking) when the write fails. The optimistic
 *   change is KEPT in the session so the user always sees the theme/font/
 *   navigation apply, even if the write to IndexedDB fails; a failed write
 *   never silently reverts a change the user just made.
 * - When `theme` is `auto`, the effective theme resolves from
 *   `prefers-color-scheme` via `useMediaQuery`, re-applying live when the OS
 *   preference changes (spec "Auto follows system").
 *
 * Wired in `bootstrap.tsx` INSIDE `<ServicesProvider>` (the provider needs
 * `useServices().localStore`), not inside `ServicesContext`/`buildServices`
 * (D2 — `Services` holds only ports; the visual settings service functions
 * stay deps-injected and are called here directly).
 */
import { createContext, type ComponentChildren } from "preact";
import { useContext, useEffect, useMemo, useState } from "preact/hooks";
import type { VisualSettings } from "../../domain/visual/visualSettings";
import { DEFAULT_VISUAL_SETTINGS } from "../../domain/visual/visualSettings";
import { loadVisualSettings, saveVisualSettings } from "../../services/visualSettings";
import { applyVisualSettings, resolveTheme } from "../theme";
import { useMediaQuery } from "../useMediaQuery";
import { useServices } from "./ServicesContext";

export interface SettingsContextValue {
  settings: VisualSettings;
  status: "loading" | "ready";
  saveError: string | null;
  updateSettings(patch: Partial<VisualSettings>): void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

const DARK_MEDIA_QUERY = "(prefers-color-scheme: dark)";

export function SettingsProvider({ children }: { children: ComponentChildren }) {
  const services = useServices();
  const [settings, setSettings] = useState<VisualSettings>(DEFAULT_VISUAL_SETTINGS);
  const [status, setStatus] = useState<"loading" | "ready">("loading");
  const [saveError, setSaveError] = useState<string | null>(null);
  const prefersDark = useMediaQuery(DARK_MEDIA_QUERY);

  // Load persisted settings on mount (before first render of settings-aware UI).
  useEffect(() => {
    let cancelled = false;
    loadVisualSettings(services).then((loaded) => {
      if (cancelled) return;
      setSettings(loaded);
      setStatus("ready");
    });
    return () => {
      cancelled = true;
    };
    // `services` is a stable identity for the provider's lifetime, so it is
    // intentionally not listed as a dependency.
  }, []);

  const resolvedTheme = resolveTheme(settings.theme, prefersDark);

  // Apply the resolved theme + font tokens to <html> whenever they change.
  useEffect(() => {
    applyVisualSettings(settings, resolvedTheme, document.documentElement);
  }, [settings, resolvedTheme]);

  const updateSettings = (patch: Partial<VisualSettings>) => {
    // Merge optimistically and apply immediately. The new value stays in the
    // session even if the persist write fails, so the user always sees the
    // change take effect (a failed write must not silently undo the click).
    const next = { ...settings, ...patch };
    setSettings(next);
    setSaveError(null);
    saveVisualSettings(services, next).then((result) => {
      if (result.status === "error") {
        setSaveError(result.message);
      }
    });
  };

  const value = useMemo<SettingsContextValue>(
    () => ({ settings, status, saveError, updateSettings }),
    // `updateSettings` is recreated each render; including it would re-create
    // the value every render. Its closure captures the latest `settings`, so
    // consumers reading `settings` directly stay correct regardless.
    [settings, status, saveError],
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

/** Throws when used outside a `<SettingsProvider>` — a wiring bug, not a state. */
export function useVisualSettings(): SettingsContextValue {
  const value = useContext(SettingsContext);
  if (value === null) {
    throw new Error("useVisualSettings() must be called within a <SettingsProvider>.");
  }
  return value;
}
