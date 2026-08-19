/**
 * Composition root (Slice 1 stub). This is the only file allowed to construct
 * adapters and wire them into services once those layers exist (design.md §1).
 */
import { render } from "preact";
import { App } from "./app/App";

const rootElement = document.getElementById("app");

if (!rootElement) {
  throw new Error("Root element #app not found");
}

render(<App />, rootElement);
