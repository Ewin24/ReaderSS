/**
 * `useViewportPageSize` derives the content page size from the reading
 * pane's measured height. jsdom performs no layout and ships no
 * ResizeObserver, so both are stubbed here: the point under test is the
 * hook's ATTACH/MEASURE logic, not the browser's layout engine.
 *
 * The late-mount case is the regression that matters. On a narrow viewport
 * the pane is not in the DOM when the hook first runs, and the original
 * one-shot `querySelector` gave up permanently, pinning the page size at the
 * fallback and leaving content pagination wrong for the whole session.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/preact";
import { useViewportPageSize } from "./useViewportPageSize";

const PANE_CLASS = "reading-pane";

/** Minimal ResizeObserver stub: records observed elements, never fires. */
class StubResizeObserver {
  static observed: Element[] = [];
  observe(el: Element) {
    StubResizeObserver.observed.push(el);
  }
  unobserve() {}
  disconnect() {}
}

function Probe() {
  const perPage = useViewportPageSize(`.${PANE_CLASS}`, 6);
  return <span data-testid="per-page">{perPage}</span>;
}

function paneWithHeight(height: number): HTMLElement {
  const el = document.createElement("div");
  el.className = PANE_CLASS;
  Object.defineProperty(el, "clientHeight", { value: height, configurable: true });
  return el;
}

describe("useViewportPageSize", () => {
  beforeEach(() => {
    StubResizeObserver.observed = [];
    vi.stubGlobal("ResizeObserver", StubResizeObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.querySelectorAll(`.${PANE_CLASS}`).forEach((el) => el.remove());
  });

  it("falls back when ResizeObserver is unavailable", () => {
    vi.stubGlobal("ResizeObserver", undefined);
    render(<Probe />);

    expect(screen.getByTestId("per-page").textContent).toBe("6");
  });

  it("derives the page size from the pane height when the pane already exists", async () => {
    document.body.appendChild(paneWithHeight(900));
    render(<Probe />);

    // 900 / 180 = 5 blocks that fit.
    await waitFor(() => expect(screen.getByTestId("per-page").textContent).toBe("5"));
  });

  it("clamps to at least one block for a very short pane", async () => {
    document.body.appendChild(paneWithHeight(40));
    render(<Probe />);

    await waitFor(() => expect(screen.getByTestId("per-page").textContent).toBe("1"));
  });

  it("attaches to a pane that mounts AFTER the hook first runs", async () => {
    render(<Probe />);
    expect(screen.getByTestId("per-page").textContent).toBe("6");

    document.body.appendChild(paneWithHeight(720));

    // 720 / 180 = 4. Without the late-attach watcher this stays at 6 forever.
    await waitFor(() => expect(screen.getByTestId("per-page").textContent).toBe("4"));
  });
});
