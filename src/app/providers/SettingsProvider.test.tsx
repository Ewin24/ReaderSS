import { feedsmithOpmlCodec } from "../../adapters/opml/feedsmithOpmlCodec";
/**
 * Tests for SettingsProvider and useVisualSettings.
 *
 * The provider loads persisted `config/visual` on mount, applies the resolved
 * theme/font tokens to `documentElement`, follows `prefers-color-scheme` when
 * theme is `auto`, and persists every `updateSettings` call optimistically
 * (reverting + surfacing `saveError` when the write fails).
 *
 * The localStore here is a plain stub: the provider calls
 * `loadVisualSettings`/`saveVisualSettings` (Slice 2) against it, which are
 * already unit-tested. This suite proves the provider's wiring — state,
 * context, the apply effect, and the revert-on-error path.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/preact";
import { h } from "preact";
import type { LocalStorePort } from "../../ports/LocalStorePort";
import { SettingsProvider, useVisualSettings } from "./SettingsProvider";
import { ServicesProvider } from "./ServicesContext";
import type { ClockPort } from "../../ports/ClockPort";
import type { FeedSourcePort } from "../../ports/FeedSourcePort";
import type { FeedParserPort } from "../../ports/FeedParserPort";
import { DEFAULT_VISUAL_SETTINGS } from "../../domain/visual/visualSettings";

function makeLocalStore(): LocalStorePort {
  return {
    getConfigValue: vi.fn(async () => undefined),
    putConfigValue: vi.fn(async () => undefined),
  } as unknown as LocalStorePort;
}

function stubMatchMedia(matches: boolean) {
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  const mql = {
    matches,
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addEventListener: (_type: string, cb: (e: MediaQueryListEvent) => void) => {
      listeners.add(cb);
    },
    removeEventListener: (_type: string, cb: (e: MediaQueryListEvent) => void) => {
      listeners.delete(cb);
    },
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => {
      if (query === "(prefers-color-scheme: dark)") return mql;
      return {
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      };
    }),
  );
  return { mql, listeners };
}

function Harness({ children }: { children: h.JSX.Element | null }) {
  const { settings, status, saveError, updateSettings } = useVisualSettings();
  return (
    <div>
      <output data-testid="theme">{settings.theme}</output>
      <output data-testid="font">{settings.fontFamily}</output>
      <output data-testid="font-size">{settings.fontSize}</output>
      <output data-testid="nav-mode">{settings.navMode}</output>
      <output data-testid="status">{status}</output>
      <output data-testid="save-error">{saveError ?? "none"}</output>
      <button onClick={() => updateSettings({ fontSize: "lg" })}>Set size lg</button>
      {children}
    </div>
  );
}

const clock: ClockPort = { now: () => "2026-08-19T10:00:00.000Z" };
const feedSource: FeedSourcePort = { fetchFeed: vi.fn() };
const feedParser: FeedParserPort = { parse: vi.fn() };

/** Wraps the provider inside a ServicesProvider, mirroring bootstrap.tsx. */
function renderProvider(localStore: LocalStorePort, children: h.JSX.Element) {
  return render(
    <ServicesProvider services={{ localStore, clock, feedSource, feedParser, opmlCodec: feedsmithOpmlCodec }}>
      <SettingsProvider>{children}</SettingsProvider>
    </ServicesProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-font");
  document.documentElement.removeAttribute("data-font-size");
});

describe("SettingsProvider", () => {
  it("loads persisted settings on mount and exposes them via context as ready", async () => {
    stubMatchMedia(false);
    const localStore = makeLocalStore();
    localStore.getConfigValue = vi.fn(async <T,>(key: string): Promise<T | undefined> => {
      if (key === "visual") {
        return { theme: "dark", fontFamily: "serif", fontSize: "lg", navMode: "paginated" } as T;
      }
      return undefined;
    }) as LocalStorePort["getConfigValue"];

    renderProvider(localStore, <Harness>{null}</Harness>);

    await waitFor(() => expect(screen.getByTestId("theme")).toHaveTextContent("dark"));
    expect(screen.getByTestId("font")).toHaveTextContent("serif");
    expect(screen.getByTestId("font-size")).toHaveTextContent("lg");
    expect(screen.getByTestId("nav-mode")).toHaveTextContent("paginated");
    expect(screen.getByTestId("status")).toHaveTextContent("ready");
  });

  it("uses defaults when no persisted key exists", async () => {
    stubMatchMedia(false);
    const localStore = makeLocalStore();

    renderProvider(localStore, <Harness>{null}</Harness>);

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("ready"));
    expect(screen.getByTestId("theme")).toHaveTextContent(DEFAULT_VISUAL_SETTINGS.theme);
    expect(screen.getByTestId("nav-mode")).toHaveTextContent(DEFAULT_VISUAL_SETTINGS.navMode);
  });

  it("updateSettings updates the context and persists to config/visual", async () => {
    stubMatchMedia(false);
    const localStore = makeLocalStore();

    renderProvider(localStore, <Harness>{null}</Harness>);

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("ready"));
    screen.getByText("Set size lg").click();

    await waitFor(() => expect(screen.getByTestId("font-size")).toHaveTextContent("lg"));
    await waitFor(() =>
      expect(localStore.putConfigValue).toHaveBeenCalledWith(
        "visual",
        expect.objectContaining({ fontSize: "lg" }),
      ),
    );
  });

  it("keeps the optimistic change and sets saveError when the save fails", async () => {
    stubMatchMedia(false);
    const localStore = makeLocalStore();
    localStore.putConfigValue = vi.fn(async () => {
      throw new Error("IDB blocked");
    });

    renderProvider(localStore, <Harness>{null}</Harness>);

    await waitFor(() => expect(screen.getByTestId("status")).toHaveTextContent("ready"));
    screen.getByText("Set size lg").click();

    // The optimistic change stays visible in the session (a failed write must
    // not silently undo the click), and the failure is surfaced non-blocking.
    await waitFor(() => expect(screen.getByTestId("font-size")).toHaveTextContent("lg"));
    await waitFor(() => expect(screen.getByTestId("save-error")).toHaveTextContent(/IDB blocked/i));
  });

  it("applies theme/font data attributes to documentElement on mount", async () => {
    stubMatchMedia(false);
    const localStore = makeLocalStore();
    localStore.getConfigValue = vi.fn(async <T,>(key: string): Promise<T | undefined> => {
      if (key === "visual") {
        return { theme: "dark", fontFamily: "serif", fontSize: "lg" } as T;
      }
      return undefined;
    }) as LocalStorePort["getConfigValue"];

    renderProvider(localStore, <Harness>{null}</Harness>);

    await waitFor(() =>
      expect(document.documentElement).toHaveAttribute("data-theme", "dark"),
    );
    expect(document.documentElement).toHaveAttribute("data-font", "serif");
    expect(document.documentElement).toHaveAttribute("data-font-size", "lg");
  });

  it("follows prefers-color-scheme live when theme is auto", async () => {
    const { mql, listeners } = stubMatchMedia(false);
    const localStore = makeLocalStore();

    renderProvider(localStore, <Harness>{null}</Harness>);

    await waitFor(() =>
      expect(document.documentElement).toHaveAttribute("data-theme", "light"),
    );

    // Simulate the OS switching to dark while theme is auto.
    mql.matches = true;
    listeners.forEach((listener) => listener({ matches: true } as MediaQueryListEvent));

    await waitFor(() =>
      expect(document.documentElement).toHaveAttribute("data-theme", "dark"),
    );
  });

  it("useVisualSettings throws outside a provider", () => {
    stubMatchMedia(false);
    expect(() => {
      render(<Harness>{null}</Harness>);
    }).toThrow(/SettingsProvider/i);
  });
});
