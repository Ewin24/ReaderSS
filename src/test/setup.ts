import "fake-indexeddb/auto";
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/preact";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
  indexedDB.deleteDatabase("readerss");
});
