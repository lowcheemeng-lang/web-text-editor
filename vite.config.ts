/// <reference types="node" />
/*
 * This reference is deliberate and local: the config is Node code (it reads the worker template
 * and the manifest off disk), while `src/` stays a browser-only program — `tsconfig.json` still
 * lists only `vite/client` in `types`, so no Node global leaks into application code.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { defineConfig, type Plugin } from "vite";

/**
 * Where the offline-shell template and the manifest live, and the files Vite copies from `public/`
 * into the output root. They are not part of the bundle (Vite copies `publicDir` outside Rollup's
 * graph), so the shell list is written out here — `scripts/check-precache.mjs` re-derives it from
 * `dist/` and fails if the manifest names an icon this list is missing, which is the only way the
 * two could drift apart without a sound.
 */
const WORKER_SOURCE = new URL("./src/pwa/service-worker.js", import.meta.url);
const MANIFEST_SOURCE = new URL("./public/manifest.webmanifest", import.meta.url);
const PUBLIC_SHELL = [
  "manifest.webmanifest",
  "icon-192.png",
  "icon-512.png",
  "icon-maskable-512.png",
];

/**
 * The offline shell (Task 8).
 *
 * Emits `dist/sw.js` from `src/pwa/service-worker.js`, replacing its two placeholders with the
 * build's own facts:
 *
 *   `__NPP_PWA_PRECACHE__`  every file the **first load** needs, derived from the bundle rather
 *                           than from a hand-kept list: `index.html`, everything it references,
 *                           the `public/` shell files above, and the entry chunks' **static**
 *                           import closure. Rename a chunk and the list follows, because the file
 *                           names carry their hashes.
 *   `__NPP_PWA_VERSION__`   a hash of that list plus the worker's own source, so a change to
 *                           either starts a new cache and `activate` deletes the old one.
 *
 * What is deliberately *not* in the list is the other ~127 chunks — D9's 140 lazily imported
 * languages and the Lezer runtimes they share (~1.2 MB raw). Precaching them would put the whole
 * language set on the wire before the first paint, which is the opposite of what the lazy imports
 * are for. The worker caches them on first use instead, and `src/pwa/service-worker.js` states the
 * consequence in full: a language never opened while online is not available offline.
 *
 * The build prints both sets — counts, and the files themselves — because the composition of the
 * shell is the evidence: a regression that quietly moves a megabyte into the first load is exactly
 * the failure this plugin could hide. `scripts/check-precache.mjs` re-derives both sets from
 * `dist/` and prints their measured weight, which is the number `PROGRESS.md` quotes.
 */
function pwaOfflineShell(): Plugin {
  return {
    name: "pwa-offline-shell",
    apply: "build",
    // `post`: `index.html` is an *asset* that Vite's own build-html plugin emits during
    // generateBundle. Running before it, this hook cannot see the document it is deriving the
    // shell from — measured, not guessed: without this the build fails with "index.html was not
    // emitted".
    enforce: "post",
    generateBundle(_options, bundle) {
      const files = Object.values(bundle);
      const chunks = files.filter((entry) => entry.type === "chunk");
      const html = files.find((entry) => entry.fileName === "index.html");
      if (!html || html.type !== "asset" || typeof html.source !== "string") {
        throw new Error("pwa-offline-shell: index.html was not emitted, so the shell is unknowable");
      }

      // Sizes are deliberately *not* printed here: what this hook holds is the emitted source, and
      // Vite appends `sourceMappingURL` comments while writing — a second, slightly different
      // number. `scripts/check-precache.mjs` measures the written artifact and prints its weight,
      // and that is the number the ledger quotes.

      const wanted = new Set<string>(["index.html", ...PUBLIC_SHELL]);
      for (const match of html.source.matchAll(/(?:src|href)="([^"]+)"/g)) {
        const url = match[1];
        // Relative only: a data: URI is inline, and there is no other origin (D1).
        if (url && !/^(?:[a-z]+:|\/\/|#)/i.test(url)) wanted.add(url.replace(/^\.?\//, ""));
      }
      const manifest = JSON.parse(readFileSync(MANIFEST_SOURCE, "utf8")) as {
        icons?: { src?: string }[];
      };
      for (const icon of manifest.icons ?? []) {
        if (icon.src) wanted.add(icon.src.replace(/^\.?\//, ""));
      }

      // A chunk reachable without a dynamic import is first-load code. One reachable only through
      // a dynamic import is a language — and caching it here is the decision this plugin exists to
      // avoid, so the walk follows `imports` (static) and never `dynamicImports`.
      const byName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
      const staticClosure = new Set<string>();
      const queue = chunks.filter((chunk) => chunk.isEntry).map((chunk) => chunk.fileName);
      while (queue.length > 0) {
        const name = queue.pop();
        if (!name || staticClosure.has(name)) continue;
        staticClosure.add(name);
        wanted.add(name);
        const chunk = byName.get(name);
        if (!chunk) continue;
        for (const css of chunk.viteMetadata?.importedCss ?? []) wanted.add(css);
        for (const imported of chunk.imports) queue.push(imported);
      }

      const precache = [...wanted].sort();
      const lazy = chunks.filter((chunk) => !staticClosure.has(chunk.fileName));
      const template = readFileSync(WORKER_SOURCE, "utf8");
      const version = createHash("sha256")
        .update([...precache, template].join("\n"))
        .digest("hex")
        .slice(0, 12);
      const source = template
        .replace("__NPP_PWA_VERSION__", version)
        .replace("__NPP_PWA_PRECACHE__", JSON.stringify(precache));
      if (source.includes("__NPP_PWA_")) {
        throw new Error("pwa-offline-shell: a placeholder survived injection — check the template");
      }

      this.emitFile({ type: "asset", fileName: "sw.js", source });
      this.info(
        `[task 8] offline shell npp-web-${version}: precache ${precache.length} files, ` +
          `${JSON.stringify(precache)}; lazy ${lazy.length} chunks cached on first use — ` +
          `'node scripts/check-precache.mjs' for the measured weight`,
      );
    },
  };
}

export default defineConfig({
  // Relative asset URLs so the built bundle can later be served from a subpath,
  // a PWA cache, or opened straight from disk (Task 8).
  base: "./",

  plugins: [pwaOfflineShell()],

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
