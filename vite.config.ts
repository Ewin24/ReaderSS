/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import { VitePWA } from "vite-plugin-pwa";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    preact(),
    VitePWA({
      registerType: "prompt",
      injectRegister: "script",
      manifest: {
        name: "ReaderSS",
        short_name: "ReaderSS",
        description: "A lightweight, offline-capable RSS reader",
        start_url: "/",
        display: "standalone",
        theme_color: "#111111",
        background_color: "#111111",
        icons: [],
      },
    }),
  ],
  build: {
    outDir: "dist",
  },
  test: {
    // openspec/config.yaml's rules.verify.coverage_threshold (task 6.11):
    // raised from 0 to 70 once domain/adapter modules existed to cover
    // (design.md §7). Configured here too so `npm run test:coverage`
    // actually FAILS below 70%, rather than the number being a
    // documentation-only claim nothing enforces.
    coverage: {
      provider: "v8",
      thresholds: {
        statements: 70,
        branches: 70,
        functions: 70,
        lines: 70,
      },
    },
    projects: [
      {
        extends: true,
        test: {
          name: "domain",
          environment: "node",
          include: ["src/domain/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "app",
          environment: "jsdom",
          setupFiles: ["src/test/setup.ts"],
          include: ["src/{adapters,services,ui,app,styles}/**/*.test.{ts,tsx}"],
        },
      },
      {
        extends: true,
        test: {
          name: "worker",
          environment: "node",
          include: ["worker/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "shared",
          environment: "node",
          include: ["shared/**/*.test.ts"],
        },
      },
    ],
  },
});
