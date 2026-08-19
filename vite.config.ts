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
    ],
  },
});
