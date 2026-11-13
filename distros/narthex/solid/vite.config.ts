import { fileURLToPath } from "node:url";
import { fileRoutes } from "filesystem-routing/vite";
import solid from "@solidjs/vite-plugin";
import { defineConfig, type Plugin } from "vite";
import { imagetools } from "vite-imagetools";
import { apiReadinessPlugin } from "./api-readiness-proxy";
import { publicBootstrapPlugin, generatedDataBuildPlugin, generatedDataChunk } from "./public-bootstrap-plugin.mjs";
import { accountDocumentPlugin } from "./account-document-plugin.mjs";
import { engineBodyReplayPlugins } from "./engine-body-replay-plugin.mjs";

// Replaces the SolidStart 1.x app.config.ts. Start mode owns the entries,
// the dev server and the production build; SolidStart and Vinxi are gone.
// Solid 2 keeps this app client-rendered (the old `ssr: false`) by simply not
// setting `ssr: true` — start mode's default is SPA with a prerendered shell.

function noCachePlugin(): Plugin {
  return {
    name: "no-cache",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.startsWith("/r/")) return next();
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
        res.setHeader("Pragma", "no-cache");
        res.setHeader("Expires", "0");
        next();
      });
    },
  };
}

// S1b: the authoring worker's engine-body replay artifact. Production binds
// at build time; dev binds at startup and retires it on source changes.
const engineBodyReplay = engineBodyReplayPlugins();

export default defineConfig({
  // The repo root holds the shared .env; keep the SolidStart envDir behaviour.
  envDir: fileURLToPath(new URL("../../../", import.meta.url)),
  plugins: [
    accountDocumentPlugin(),
    engineBodyReplay.main,
    publicBootstrapPlugin(),
    generatedDataBuildPlugin(),
    noCachePlugin(),
    apiReadinessPlugin(),
    // `extensions` lets the Solid transform also compile the `?pick=` route
    // modules that filesystem-routing emits (their ids carry a query suffix).
    solid({ start: true, extensions: [".jsx", ".tsx"] }),
    fileRoutes(),
    imagetools(),
  ],
  // These are loaded by the editor/map surfaces on demand. Discovering them
  // only after the first Browse/New click makes Vite rebuild shared chunks
  // and reload the page, losing that pending action. Prebundle the libraries
  // without importing the engine or mounting those surfaces during Home boot.
  optimizeDeps: {
    include: [
      "@solidjs/meta",
      "@codemirror/autocomplete",
      "@codemirror/commands",
      "@codemirror/language",
      "@codemirror/lint",
      "@codemirror/state",
      "@codemirror/theme-one-dark",
      "@codemirror/view",
      "@lezer/highlight",
      "maplibre-gl",
    ],
  },
  resolve: {
    // Start mode does not provide SolidStart's `~` alias; 332 imports use it.
    alias: {
      "~": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  // Document probes: start mode uses `appType: "custom"`, so there is no Vite
  // SPA fallback for document URLs; the plugin serves the shell for GETs whose
  // Accept header explicitly contains "text/html". `GET /` with `Accept: */*`
  // and `HEAD /` both return 404, and neither tests browser navigation:
  //     curl -H 'Accept: text/html' http://localhost:3100/
  // Check application readiness with a visible selector in a real browser.
  // Background: workstreams/solid-2-migration/notes/2026-09-15-document-route-retraction.md
  server: {
    port: 3100,
    allowedHosts: ["dev.usefenel.com", "fenel.aajonus.app"],
    proxy: {
      "/api": { target: "http://127.0.0.1:3001", changeOrigin: true },
      "/webhooks": { target: "http://127.0.0.1:3001", changeOrigin: true },
      "/r": { target: "http://127.0.0.1:3001", changeOrigin: true },
    },
  },
  preview: {
    port: 3100,
  },
  // Cloudflare Pages limits each asset to 25 MiB. Keep the complete worker
  // graph, but emit its existing generated DATA modules as separate ES chunks.
  // This changes packaging only; worker readiness and checked inputs stay owned
  // by their existing clients. ES output alone still leaves scalar/field workers
  // above the cap. See the 2026-10-05 worker-file-cap evidence note.
  worker: {
    format: "es",
    // Worker builds need their own Solid transform for shared JSX dependencies.
    plugins: () => [engineBodyReplay.worker(), generatedDataBuildPlugin(), solid({ extensions: [".jsx", ".tsx"] })],
    rollupOptions: {
      output: {
        // Same chunk names as the page build below: the data chunks are byte-identical in both
        // builds (parse cache parts, identity manifest, field catalogue), the file name carries a
        // content hash, and Vite keeps one file when name and content agree. A browser then
        // downloads each of them once for the page and its workers instead of twice.
        manualChunks(id) {
          return generatedDataChunk(id, "engine-data-");
        },
      },
    },
  },
  build: {
    target: "esnext",
    // Keep images as asset files instead of inlining them into the JS bundle.
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        manualChunks(id) {
          return generatedDataChunk(id, "engine-data-");
        },
      },
    },
  },
});
