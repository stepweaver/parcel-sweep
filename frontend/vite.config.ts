import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const SITE_ORIGIN_PLACEHOLDER = "%SITE_ORIGIN%";

function resolveSiteOrigin(): string {
  const fromEnv = process.env.VITE_SITE_ORIGIN ?? process.env.FRONTEND_ORIGIN;
  return (fromEnv ?? "http://localhost:5173").replace(/\/$/, "");
}

function injectSiteOrigin(html: string, isBuild: boolean): string {
  // Production builds keep placeholders unless the public URL is known at build time.
  // The Express server replaces them at runtime from FRONTEND_ORIGIN / platform env.
  if (isBuild && !process.env.VITE_SITE_ORIGIN && !process.env.FRONTEND_ORIGIN) {
    return html;
  }
  return html.replaceAll(SITE_ORIGIN_PLACEHOLDER, resolveSiteOrigin());
}

export default defineConfig({
  plugins: [
    react(),
    {
      name: "inject-site-origin",
      transformIndexHtml: {
        order: "pre",
        handler(html, ctx) {
          return injectSiteOrigin(html, ctx.server == null);
        },
      },
    },
  ],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
      "/socket.io": {
        target: "http://localhost:3000",
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
