import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  envDir: path.resolve(__dirname, "../.."),
  server: {
    port: 5173,
    proxy: {
      "/api": {
        // API_TARGET=https://app.sparklerss.com runs the local UI against prod
        target: process.env.API_TARGET ?? "http://localhost:8787",
        changeOrigin: true,
      },
    },
  },
  // `vite preview` serves the production build with the same API proxy, so it
  // can stand in for the deployed SPA (Lighthouse, manual E2E).
  preview: {
    port: 4173,
    proxy: {
      "/api": {
        target: process.env.API_TARGET ?? "http://localhost:8787",
        changeOrigin: true,
      },
    },
  },
  build: {
    sourcemap: false,
    target: "es2022",
    rollupOptions: {
      output: {
        // Split stable third-party code into cache-friendly vendor chunks so
        // library bumps don't invalidate the app shell and vice-versa.
        manualChunks: {
          react: ["react", "react-dom"],
          query: ["@tanstack/react-query", "@tanstack/react-virtual"],
          mantine: ["@mantine/core", "@mantine/hooks"],
          oidc: ["oidc-client-ts"],
          state: ["jotai"],
          routes: ["wouter"],
          icons: ["react-icons"],
        },
      },
    },
    chunkSizeWarningLimit: 700,
  },
});
