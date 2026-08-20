/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import { VitePWA } from "vite-plugin-pwa";
import { cloudflare } from "@cloudflare/vite-plugin";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    // Runs the actual Worker (worker/index.ts, reading wrangler.toml) inside
    // Vite's own dev server via workerd, so `npm run dev` serves the app AND
    // `/api/*` on one origin/port with HMR intact. Without this, `vite` alone
    // has no `/api/feed` route — any request to it falls through to Vite's
    // own SPA history-fallback and returns `index.html` with a 200, which the
    // client then hands to the feed parser as if it were feed content (the
    // exact bug `RELAY_UNAVAILABLE` in `relayFeedSource.ts` now detects and
    // reports honestly instead of silently mis-parsing).
    //
    // Excluded under Vitest (`process.env.VITEST`): the plugin validates every
    // Vite "environment" at config-resolve time and rejects Vitest's own
    // `worker`/`domain` node-environment `resolve.external` node-builtins
    // list as incompatible with a Cloudflare Worker environment. Vitest never
    // needs the plugin anyway — `worker/**` tests call `handleFeedRequest`
    // directly with `new Request()` and stub `fetch`, per design.md's testing
    // strategy; no live Worker or dev server is involved in the test run.
    ...(process.env.VITEST ? [] : [cloudflare()]),
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
