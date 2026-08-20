/**
 * Composition root: this is the only construction site in the app.
 * `bootstrapApp()` (src/app/composition/bootstrap.tsx) does the actual
 * construction and mounting, so it stays independently testable under jsdom
 * (this file itself sits outside every Vitest project's `include` glob) --
 * this file's only job is to find the root element and call it once.
 *
 * `bootstrapApp` never rejects: it catches its own `buildServices()` failure
 * and renders a visible fallback into `rootElement` instead. Without that,
 * a rejection here would leave a permanently blank page, since the error
 * boundary only catches errors thrown during rendering and no tree exists
 * yet at that point. So `void bootstrapApp(...)` below is safe with no
 * `.catch()` of its own to add.
 */
import { bootstrapApp } from "./app/composition/bootstrap";

const rootElement = document.getElementById("app");

if (!rootElement) {
  throw new Error("Root element #app not found");
}

void bootstrapApp(rootElement);
