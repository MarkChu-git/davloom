import stylex from "@stylexjs/unplugin/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    stylex({
      useCSSLayers: true,
      unstable_moduleResolution: { type: "commonJS" },
    }),
    tanstackStart({
      // The Dashboard is a client-side app. `index` lets static hosts use it as their SPA fallback.
      spa: { enabled: true, prerender: { outputPath: "/index" } },
    }),
    react(),
  ],
});
