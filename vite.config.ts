/// <reference types="vitest" />
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  build: {
    target: "es2020",
    // keep the bundled flag SVGs as individual precached files instead of base64
    // data-URIs in the JS bundle (most are tiny and would otherwise inline)
    assetsInlineLimit: (filePath) => (filePath.includes("flag-icons") ? false : undefined),
  },
  plugins: [
    VitePWA({
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
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,webmanifest}"],
        // Deep-link routes (/atp/2024/wimbledon …) are virtual — no file at that path. Serve the
        // precached app shell for any navigation so shared links work in the installed/offline PWA
        // too (online, the Vercel rewrite covers it). Data is runtime-cached, never the shell.
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/data\//],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/data/"),
            handler: "StaleWhileRevalidate",
            options: { cacheName: "tennisarc-data", expiration: { maxEntries: 64, maxAgeSeconds: 86400 } },
          },
        ],
      },
    }),
  ],
  test: {
    globals: true,
    environment: "node",
    // parallel Claude sessions keep git worktrees under .claude/worktrees — without this
    // exclude their checked-out test copies double the suite (and can fail it from outside)
    exclude: ["**/node_modules/**", "**/dist/**", "**/.claude/**"],
  },
});
