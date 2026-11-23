import stylex from "@stylexjs/unplugin/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type ProxyOptions } from "vite";

// `vite dev` serves the Dashboard alone. Set DAVLOOM_API_ORIGIN to a running instance, such as a
// local Worker, and the dev server passes /api and /dav to it. The proxy names the instance as the
// request's origin, so Better Auth takes a sign-in made through the dev server as its own.
const apiOrigin = process.env.DAVLOOM_API_ORIGIN;

const toInstance = (target: string): ProxyOptions => ({
  target,
  changeOrigin: true,
  configure: (proxy) => {
    proxy.on("proxyReq", (request) => {
      if (request.getHeader("origin") !== undefined) {
        request.setHeader("origin", target);
      }
    });
  },
});

export default defineConfig({
  server:
    apiOrigin === undefined || apiOrigin === ""
      ? {}
      : { proxy: { "/api": toInstance(apiOrigin), "/dav": toInstance(apiOrigin) } },
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
