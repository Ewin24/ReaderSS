import { describe, expect, it, vi } from "vitest";
import type { LocalStorePort } from "../ports/LocalStorePort";
import type { VisualSettings } from "../domain/visual/visualSettings";
import { DEFAULT_VISUAL_SETTINGS } from "../domain/visual/visualSettings";
import { loadVisualSettings, saveVisualSettings } from "./visualSettings";

function makeLocalStore(overrides: Partial<LocalStorePort> = {}): LocalStorePort {
  return {
    getFeed: vi.fn(),
    listFeeds: vi.fn(),
    listFeedsByFolder: vi.fn(),
    putFeed: vi.fn(),
    putFeedWithEntries: vi.fn(),
    addFeedWithEntries: vi.fn(),
    deleteFeed: vi.fn(),
    getEntry: vi.fn(),
    getEntryByFeedAndGuid: vi.fn(),
    putEntry: vi.fn(),
    deleteEntry: vi.fn(),
    listEntriesByFeed: vi.fn(),
    listEntriesByFeedPublished: vi.fn(),
    listEntriesByPublished: vi.fn(),
    listUnreadEntries: vi.fn(),
    listStarredEntries: vi.fn(),
    getConfigValue: vi.fn(),
    putConfigValue: vi.fn(),
    ...overrides,
  } as unknown as LocalStorePort;
}

const fullSettings: VisualSettings = {
  theme: "dark",
  fontFamily: "serif",
  fontSize: "lg",
  navMode: "paginated",
  visualTheme: "classic",
};

describe("loadVisualSettings", () => {
  it("returns the stored value when config/visual is present", async () => {
    const localStore = makeLocalStore({
      getConfigValue: vi.fn().mockResolvedValue(fullSettings),
    });

    const settings = await loadVisualSettings({ localStore });

    expect(localStore.getConfigValue).toHaveBeenCalledWith("visual");
    expect(settings).toEqual(fullSettings);
  });

  it("returns defaults when config/visual is absent", async () => {
    const localStore = makeLocalStore({
      getConfigValue: vi.fn().mockResolvedValue(undefined),
    });

    const settings = await loadVisualSettings({ localStore });

    expect(settings).toEqual(DEFAULT_VISUAL_SETTINGS);
  });

  it("normalizes a partial stored record against defaults", async () => {
    const localStore = makeLocalStore({
      getConfigValue: vi.fn().mockResolvedValue({ theme: "dark" }),
    });

    const settings = await loadVisualSettings({ localStore });

    expect(settings).toEqual({
      theme: "dark",
      fontFamily: "system",
      fontSize: "base",
      navMode: "auto",
      visualTheme: "flat",
    });
  });

  it("returns defaults (never rejects) when the store throws", async () => {
    const localStore = makeLocalStore({
      getConfigValue: vi.fn().mockRejectedValue(new Error("store down")),
    });

    const settings = await loadVisualSettings({ localStore });

    expect(settings).toEqual(DEFAULT_VISUAL_SETTINGS);
  });
});

describe("saveVisualSettings", () => {
  it("writes { key: 'visual', value: settings } via putConfigValue and reports saved", async () => {
    const localStore = makeLocalStore({
      putConfigValue: vi.fn().mockResolvedValue(undefined),
    });

    const result = await saveVisualSettings({ localStore }, fullSettings);

    expect(result).toEqual({ status: "saved" });
    expect(localStore.putConfigValue).toHaveBeenCalledWith("visual", fullSettings);
  });

  it("returns { status: 'error', message } when putConfigValue rejects", async () => {
    const localStore = makeLocalStore({
      putConfigValue: vi.fn().mockRejectedValue(new Error("quota exceeded")),
    });

    const result = await saveVisualSettings({ localStore }, fullSettings);

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.message).toContain("quota exceeded");
    }
  });
});
