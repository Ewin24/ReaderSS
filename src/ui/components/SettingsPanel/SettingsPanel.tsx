/**
 * Presentational settings panel: four control groups (theme, font family,
 * font size, nav mode), props-in / callbacks-out. This component never
 * touches the store or the DOM — it renders the current `settings` and
 * reports each change via `onUpdateSettings` with the smallest partial patch.
 * Persistence is the SettingsProvider's job; this panel is pure UI.
 */
import type { VisualSettings } from "../../../domain/visual/visualSettings";
import {
  FONT_FAMILY_OPTIONS,
  FONT_SIZE_OPTIONS,
  NAV_MODE_OPTIONS,
  THEME_OPTIONS,
} from "../../../domain/visual/visualSettings";

export interface SettingsPanelProps {
  settings: VisualSettings;
  onUpdateSettings(patch: Partial<VisualSettings>): void;
}

interface Option {
  value: string;
  label: string;
}

const THEME_LABELS: Record<string, string> = {
  light: "Light",
  dark: "Dark",
  auto: "Auto",
};

const FONT_LABELS: Record<string, string> = {
  system: "System",
  serif: "Serif",
  sans: "Sans",
  mono: "Mono",
};

const SIZE_LABELS: Record<string, string> = {
  sm: "Small",
  base: "Base",
  lg: "Large",
  xl: "Extra large",
};

const NAV_LABELS: Record<string, string> = {
  auto: "Infinite scroll",
  paginated: "Paginated",
};

function optionList(values: readonly string[], labels: Record<string, string>): Option[] {
  return values.map((value) => ({ value, label: labels[value] ?? value }));
}

function ControlGroup({
  legend,
  name,
  options,
  current,
  onChange,
}: {
  legend: string;
  name: string;
  options: Option[];
  current: string;
  onChange(value: string): void;
}) {
  return (
    <fieldset class="settings-panel__group">
      <legend class="settings-panel__legend">{legend}</legend>
      <div class="settings-panel__options">
        {options.map((option) => (
          <label key={option.value} class="settings-panel__option">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={current === option.value}
              onChange={() => onChange(option.value)}
            />
            <span class="settings-panel__option-label">{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function SettingsPanel({ settings, onUpdateSettings }: SettingsPanelProps) {
  return (
    <section class="settings-panel" aria-label="Visual settings">
      <ControlGroup
        legend="Theme"
        name="theme"
        options={optionList(THEME_OPTIONS, THEME_LABELS)}
        current={settings.theme}
        onChange={(value) => onUpdateSettings({ theme: value as VisualSettings["theme"] })}
      />
      <ControlGroup
        legend="Font family"
        name="font-family"
        options={optionList(FONT_FAMILY_OPTIONS, FONT_LABELS)}
        current={settings.fontFamily}
        onChange={(value) =>
          onUpdateSettings({ fontFamily: value as VisualSettings["fontFamily"] })
        }
      />
      <ControlGroup
        legend="Font size"
        name="font-size"
        options={optionList(FONT_SIZE_OPTIONS, SIZE_LABELS)}
        current={settings.fontSize}
        onChange={(value) => onUpdateSettings({ fontSize: value as VisualSettings["fontSize"] })}
      />
      <ControlGroup
        legend="Navigation"
        name="nav-mode"
        options={optionList(NAV_MODE_OPTIONS, NAV_LABELS)}
        current={settings.navMode}
        onChange={(value) => onUpdateSettings({ navMode: value as VisualSettings["navMode"] })}
      />
    </section>
  );
}
