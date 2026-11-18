import stylex from "@stylexjs/unplugin/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    stylex({
      useCSSLayers: true,
      // Astryx ships compiled without debug, so its style keys are bare hashes. Debug, which
      // `vite dev` turns on by default, puts the property name in front of ours, and then
      // `stylex.props` keeps Astryx's class next to ours instead of replacing it. Where the two
      // rules share a layer, Astryx's can win on the dev server and lose in the build. Without
      // debug, the dev server also leaves out the `data-style-src` attributes that name each
      // style's source file.
      debug: false,
      unstable_moduleResolution: { type: "commonJS" },
    }),
    tanstackStart({
      // The Dashboard is a client-side app. `index` lets static hosts use it as their SPA fallback.
      spa: { enabled: true, prerender: { outputPath: "/index" } },
    }),
    react(),
  ],
});
