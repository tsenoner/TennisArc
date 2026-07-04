/// <reference types="vitest" />
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  build: {
    target: "es2020",
    // keep the bundled flag SVGs as individual files instead of base64 data-URIs
    // bloating the JS bundle (most are tiny and would otherwise inline)
    assetsInlineLimit: (filePath) => (filePath.includes("flag-icons") ? false : undefined),
  },
  plugins: [
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
      includeAssets: ["favicon.ico", "apple-touch-icon-180x180.png", "logo.svg"],
      manifest: {
        name: "TennisArc",
        short_name: "TennisArc",
        description: "Live radial bracket for Grand Slam tennis (ATP + WTA).",
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
  test: { globals: true, environment: "node" },
});
