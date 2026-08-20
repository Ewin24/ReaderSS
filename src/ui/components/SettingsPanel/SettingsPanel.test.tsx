/**
 * Presentational tests for SettingsPanel: props-in, callbacks-out. No store
 * or DOM side effects here — the panel just renders the four control groups
 * (theme, font family, font size, nav mode) from props and reports each
 * change via `onUpdateSettings` with the correct partial patch.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/preact";
import { SettingsPanel } from "./SettingsPanel";
import { DEFAULT_VISUAL_SETTINGS, type VisualSettings } from "../../../domain/visual/visualSettings";

const settings: VisualSettings = {
  theme: "auto",
  fontFamily: "system",
  fontSize: "base",
  navMode: "auto",
};

describe("SettingsPanel", () => {
  it("renders the four control groups from props", () => {
    render(<SettingsPanel settings={settings} onUpdateSettings={vi.fn()} />);

    expect(screen.getByRole("group", { name: /theme/i })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /font family/i })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /font size/i })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /navigation/i })).toBeInTheDocument();

    // Current values are selected.
    expect(screen.getByRole("radio", { name: /^auto$/i })).toBeChecked();
    expect(screen.getByRole("radio", { name: /^system$/i })).toBeChecked();
    expect(screen.getByRole("radio", { name: /^base$/i })).toBeChecked();
  });

  it("reports a theme change with the correct partial patch", () => {
    const onUpdateSettings = vi.fn();
    render(<SettingsPanel settings={settings} onUpdateSettings={onUpdateSettings} />);

    fireEvent.click(screen.getByRole("radio", { name: /^dark$/i }));

    expect(onUpdateSettings).toHaveBeenCalledWith({ theme: "dark" });
  });

  it("reports a font-family change with the correct partial patch", () => {
    const onUpdateSettings = vi.fn();
    render(<SettingsPanel settings={settings} onUpdateSettings={onUpdateSettings} />);

    fireEvent.click(screen.getByRole("radio", { name: /^serif$/i }));

    expect(onUpdateSettings).toHaveBeenCalledWith({ fontFamily: "serif" });
  });

  it("reports a font-size change with the correct partial patch", () => {
    const onUpdateSettings = vi.fn();
    render(<SettingsPanel settings={settings} onUpdateSettings={onUpdateSettings} />);

    fireEvent.click(screen.getByRole("radio", { name: /^large$/i }));

    expect(onUpdateSettings).toHaveBeenCalledWith({ fontSize: "lg" });
  });

  it("reports a nav-mode change with the correct partial patch", () => {
    const onUpdateSettings = vi.fn();
    render(<SettingsPanel settings={settings} onUpdateSettings={onUpdateSettings} />);

    fireEvent.click(screen.getByRole("radio", { name: /^paginated$/i }));

    expect(onUpdateSettings).toHaveBeenCalledWith({ navMode: "paginated" });
  });

  it("reflects a non-default settings object in the selected radios", () => {
    const darkSettings: VisualSettings = {
      ...DEFAULT_VISUAL_SETTINGS,
      theme: "dark",
      navMode: "paginated",
    };
    render(<SettingsPanel settings={darkSettings} onUpdateSettings={vi.fn()} />);

    expect(screen.getByRole("radio", { name: /^dark$/i })).toBeChecked();
    expect(screen.getByRole("radio", { name: /^paginated$/i })).toBeChecked();
  });
});
