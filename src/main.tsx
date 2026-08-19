/**
 * Composition root (design.md §1: "main.tsx is the only construction
 * site"). Slice 1 rendered a bare `<App>` against fixture data with nothing
 * to construct yet; Slice 10a is the first time this file has real ports to
 * build and provide. `bootstrapApp()` (src/app/composition/bootstrap.tsx)
 * does the actual construction and mounting, so it stays independently
 * testable under jsdom (this file itself sits outside every Vitest
 * project's `include` glob) -- this file's only job is to find the root
 * element and call it once.
 *
 * `bootstrapApp` never rejects: it catches its own `buildServices()`
 * failure and renders a visible fallback into `rootElement` instead
 * (Finding 1, Slice 10a correction round) -- so `void bootstrapApp(...)`
 * below is safe with no `.catch()` of its own to add.
 */
import { bootstrapApp } from "./app/composition/bootstrap";

const rootElement = document.getElementById("app");

if (!rootElement) {
  throw new Error("Root element #app not found");
}

void bootstrapApp(rootElement);
