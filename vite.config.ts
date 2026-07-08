/// <reference types="vitest" />
import { defineConfig, loadEnv, type PluginOption } from "vite";
import { configDefaults } from "vitest/config";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => {
  // Single source of truth for the data host: api.ts reads VITE_DATA_BASE_URL at runtime, and
  // the preconnect hint is derived from the same variable at build time. Unset (local dev /
  // preview serve the same-origin seed) → no preconnect needed, none emitted.
  const dataBase = process.env.VITE_DATA_BASE_URL ?? loadEnv(mode, process.cwd()).VITE_DATA_BASE_URL;
  const preconnectDataHost: PluginOption = {
    name: "preconnect-data-host",
    transformIndexHtml: () =>
      dataBase
        ? [{
            tag: "link",
            attrs: { rel: "preconnect", href: new URL(dataBase).origin, crossorigin: true },
            injectTo: "head" as const,
          }]
        : [],
  };
  return {
  build: {
    target: "es2020",
    // keep the bundled flag SVGs as individual files instead of base64 data-URIs
    // bloating the JS bundle (most are tiny and would otherwise inline)
    assetsInlineLimit: (filePath) => (filePath.includes("flag-icons") ? false : undefined),
  },
  plugins: [
    preconnectDataHost,
    VitePWA({
      // OFFLINE-FIRST REMOVAL, phase 1 (kill switch): ship a self-destroying sw.js at the same
      // URL, which unregisters the old workbox SW and clears its caches on every installed
      // client. Do NOT delete the plugin yet — /sw.js must keep resolving as real JS: the
      // vercel.json SPA catch-all would serve HTML for a deleted file (MIME error → the stale
      // registration never clears and installed clients keep the precached shell forever).
      // Phase 2, after weeks in production: remove the plugin, add a static
      // public/manifest.webmanifest + <link>s in index.html, and keep a tiny static
      // public/sw.js kill switch indefinitely.
      selfDestroying: true,
      registerType: "autoUpdate",
      manifest: {
        name: "TennisArc",
        short_name: "TennisArc",
        description: "Live radial bracket for Grand Slam tennis (ATP + WTA).",
        // A manifest is static — it can't follow prefers-color-scheme or the in-app toggle, so
        // installed-PWA chrome/splash stays the dark brand default even for light-theme users
        // (the in-page theme-color meta DOES follow, via index.html's pre-paint script +
        // applyTheme). Revisit when the static manifest lands in offline-removal phase 2.
        theme_color: "#0d1014",
        background_color: "#0d1014",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "pwa-64x64.png", sizes: "64x64", type: "image/png" },
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          { src: "maskable-icon-512x512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
  test: {
    globals: true,
    environment: "node",
    // Pin tests to UTC so date-formatting tests (formatScheduled) are deterministic regardless of
    // the host zone or how vitest is launched (npm script, IDE, bare vitest, subagent) — env is
    // applied per worker before test modules import, so render.ts's Intl formatters build in UTC.
    env: { TZ: "UTC" },
    // parallel Claude sessions keep git worktrees under .claude/worktrees — without this
    // exclude their checked-out test copies double the suite (and can fail it from outside).
    // Extend (never replace) vitest's defaults, which already cover node_modules/dist/.git etc.
    exclude: [...configDefaults.exclude, "**/.claude/**"],
  },
  };
});
