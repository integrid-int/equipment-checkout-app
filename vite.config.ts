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
        // Never let the service worker intercept SWA auth endpoints.
        // Without this, Entra's post-login callback (/.auth/login/aad/callback)
        // is served the cached index.html by the SW before SWA can process the
        // OAuth code — the session is never established and the page loops.
        navigateFallbackDenylist: [/^\/.auth\//, /^\/api\//],
        runtimeCaching: [
          {
            urlPattern: /^\/api\//,
            // Avoid caching API auth/role responses; always hit network.
            handler: "NetworkOnly",
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
});
