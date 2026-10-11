import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset URLs so the built bundle can later be served from a subpath,
  // a PWA cache, or opened straight from disk (Task 8).
  base: "./",

  server: {
    // Local-only by design: this app has no backend (decision D1).
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    open: false,
  },

  preview: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
  },

  build: {
    target: "es2022",
    sourcemap: true,
    // Keep the first-load payload small (decision D2 / advantage A1): splitting
    // the editor core out lets the app shell paint before CodeMirror parses.
    // NOTE: Vite 8 bundles with Rolldown, where `manualChunks` accepts ONLY a
    // function — the Rollup object form (`{ "editor-core": [...] }`) fails to
    // type-check. Do not "simplify" this back to an object.
    //
    // Task 6 / decision D9: the language packages are **lazily** imported and must stay out
    // of `editor-core`, because `manualChunks` wins over code splitting — assigning them to
    // that bucket silently puts all 140 languages in the first load. Measured before and
    // after this exemption; the numbers are in PROGRESS.md.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (/node_modules\/@codemirror\/(?:lang-|legacy-modes\/)/.test(id)) return undefined;
          return /node_modules\/(?:@codemirror|codemirror)\//.test(id)
            ? "editor-core"
            : undefined;
        },
      },
    },
  },
});
