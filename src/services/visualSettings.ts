/**
 * Load/save for the enumerated {@link VisualSettings} record over the
 * existing `config` store (key `visual`, DB_VERSION stays 1 — no migration).
 *
 * Follows the repo's deps-injected service convention (like
 * {@link toggleRead}): a thin function that takes a `LocalStorePort`-shaped
 * `deps` object. Per D2 this is deliberately NOT added to the `Services`
 * interface — `Services` holds only ports; the SettingsProvider calls these
 * functions with `useServices().localStore` directly.
 *
 * `loadVisualSettings` never rejects: an absent or corrupt `config/visual`
 * record, or even a throwing store, falls back to the full defaults so the
 * reader always mounts with a valid settings object (spec "Defaults on first
 * run" / "Partial/corrupt record recovers").
 */
import type { LocalStorePort } from "../ports/LocalStorePort";
import type { VisualSettings } from "../domain/visual/visualSettings";
import {
  DEFAULT_VISUAL_SETTINGS,
  VISUAL_SETTINGS_CONFIG_KEY,
  normalizeVisualSettings,
} from "../domain/visual/visualSettings";

export interface VisualSettingsDeps {
  readonly localStore: LocalStorePort;
}

/** Reads and normalizes the persisted visual settings, never rejecting. */
export async function loadVisualSettings(deps: VisualSettingsDeps): Promise<VisualSettings> {
  let raw: unknown;
  try {
    raw = await deps.localStore.getConfigValue<unknown>(VISUAL_SETTINGS_CONFIG_KEY);
  } catch {
    raw = undefined;
  }
  if (raw === undefined) {
    return { ...DEFAULT_VISUAL_SETTINGS };
  }
  return normalizeVisualSettings(raw);
}

export type SaveVisualSettingsResult =
  | { readonly status: "saved" }
  | { readonly status: "error"; readonly message: string };

/** Persists the settings immediately to `config/visual`. */
export async function saveVisualSettings(
  deps: VisualSettingsDeps,
  settings: VisualSettings,
): Promise<SaveVisualSettingsResult> {
  try {
    await deps.localStore.putConfigValue(VISUAL_SETTINGS_CONFIG_KEY, settings);
    return { status: "saved" };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : String(error) };
  }
}
