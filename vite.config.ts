import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "apple-touch-icon.png", "icons/*.png"],
      manifest: false, // We use our own manifest.json in public/
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        navigateFallbackDenylist: [
          /^\/\.auth(?:\/|$)/,
          /^\/(?:login|logout)(?:\/|$)/,
          /^\/api(?:\/|$)/,
        ],
        runtimeCaching: [
          {
            urlPattern: /^\/api\//,
            handler: "NetworkFirst",
            options: { cacheName: "api-cache", networkTimeoutSeconds: 10 },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:7071",
        changeOrigin: true,
      },
      "/.auth": {
        target: "http://localhost:4280",
        changeOrigin: true,
      },
    },
  },
  build: {
    // Vite 7 defaults to Safari 16+, which can break older iOS Safari clients.
    target: "safari14",
    cssTarget: "safari14",
  },
});
