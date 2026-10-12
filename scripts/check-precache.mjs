#!/usr/bin/env node
/*
 * Task 8 — does the emitted offline shell agree with the build it shipped in?
 *
 *     node scripts/check-precache.mjs        # exit 0 = the shell and the build agree
 *
 * `vite.config.ts` derives the service worker's precache list from the bundle and writes it into
 * `dist/sw.js`. That claim is only worth something if it can be re-derived independently, which is
 * what this script does — the same rule `scripts/gen-language-registry.mjs --check` follows for the
 * generated language table. It reads `dist/` and nothing else, rebuilds the first-load file set
 * from the emitted HTML and the emitted chunks' own `import` statements, and compares:
 *
 *   1. every file the first load needs is precached — and nothing else is;
 *   2. every precached file exists in `dist/`;
 *   3. no source map and no lazily imported chunk is precached (the Task 8 decision: a language is
 *      cached on first *use*, never at install);
 *   4. the version in `dist/sw.js` is the hash of the worker template plus that list, so a hand
 *      edit of the artifact is detectable.
 *
 * It also prints the measured weight of both sets, which is the number `PROGRESS.md` quotes: the
 * first load against the 140 languages D9 keeps lazy.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = join(root, "dist");
const workerTemplate = readFileSync(join(root, "src/pwa/service-worker.js"), "utf8");

let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "OK  " : "FAIL"}  ${name}${detail ? `  [${detail}]` : ""}`);
  if (!ok) failures += 1;
};

/** Every file under `dist/`, as paths relative to it, POSIX-separated. */
function distFiles(dir = dist, base = dist) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...distFiles(path, base));
    else found.push(relative(base, path).split("\\").join("/"));
  }
  return found.sort();
}

/** Specifiers of *static* imports/re-exports in an emitted chunk. */
function staticImports(code) {
  const specifiers = new Set();
  for (const match of code.matchAll(
    /\b(?:import|export)\s*(?:\{[^}]*\}|\*\s*as\s*[\w$]+|[\w$]+)?\s*(?:,\s*\{[^}]*\})?\s*from\s*"([^"]+)"/g,
  )) {
    specifiers.add(match[1]);
  }
  // A side-effect import has no `from`: `import"./rolldown-runtime.js";`
  for (const match of code.matchAll(/\bimport\s*"([^"]+)"/g)) specifiers.add(match[1]);
  return [...specifiers];
}

const normalise = (url) => url.replace(/^\.\//, "").replace(/^\//, "");

/** A relative specifier resolved against the file that wrote it: `assets/x.js` + `./y.js`. */
const resolveFrom = (importer, specifier) => {
  const parts = importer.split("/").slice(0, -1);
  for (const segment of specifier.split("/")) {
    if (segment === "." || segment === "") continue;
    if (segment === "..") parts.pop();
    else parts.push(segment);
  }
  return parts.join("/");
};

const all = distFiles();
const html = readFileSync(join(dist, "index.html"), "utf8");
const manifest = JSON.parse(readFileSync(join(dist, "manifest.webmanifest"), "utf8"));

/* ── re-derive the first-load set, from the build's own output ─────────────────────────────── */
const needed = new Set(["index.html", "manifest.webmanifest"]);
for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  const url = match[1];
  if (url && !/^(?:[a-z]+:|\/\/|#)/i.test(url)) needed.add(normalise(url));
}
for (const icon of manifest.icons ?? []) needed.add(normalise(icon.src));

const scripts = all.filter((file) => file.endsWith(".js") && file !== "sw.js");
// `sw.js` is excluded, not overlooked: the browser asks for it on its own update schedule, and a
// worker that precached itself would pin the version it is trying to replace. It is the one file
// in `dist/` that is neither shell nor language.
const code = new Map(scripts.map((file) => [file, readFileSync(join(dist, file), "utf8")]));
// The entry is whatever the document loads as a module: everything else is reachable from it.
const entry = [...needed].find((file) => /assets\/index-[^/]*\.js$/.test(file));
check("the emitted HTML names an entry module", Boolean(entry), String(entry));
const queue = entry ? [entry] : [];
const staticClosure = new Set();
while (queue.length > 0) {
  const file = queue.pop();
  if (staticClosure.has(file)) continue;
  staticClosure.add(file);
  for (const specifier of staticImports(code.get(file) ?? "")) {
    if (!specifier.startsWith(".")) continue; // nothing external exists here (D1)
    queue.push(resolveFrom(file, specifier));
  }
}
for (const file of staticClosure) needed.add(file);
// The app emits one stylesheet and no lazy CSS, so every emitted stylesheet is shell.
for (const file of all.filter((file) => file.endsWith(".css"))) needed.add(file);

check(
  "the entry's static import closure is non-trivial (the walk found something)",
  staticClosure.size >= 2,
  [...staticClosure].join(", "),
);

/* ── what the worker actually says ──────────────────────────────────────────────────────────── */
const worker = readFileSync(join(dist, "sw.js"), "utf8");
const version = /^const VERSION = "([^"]+)";$/m.exec(worker)?.[1] ?? null;
const precache = JSON.parse(/^const PRECACHE = (\[.*\]);$/m.exec(worker)?.[1] ?? "[]");
const precached = new Set(precache);

check("dist/sw.js declares a version", Boolean(version), String(version));
check("dist/sw.js declares a precache list", precache.length > 0, `${precache.length} files`);
check(
  "no placeholder survived the injection",
  !worker.includes("__NPP_PWA_"),
);

const missing = [...needed].filter((file) => !precached.has(file)).sort();
const extra = [...precached].filter((file) => !needed.has(file)).sort();
check(
  "every file the first load needs is precached",
  missing.length === 0,
  missing.length > 0 ? `missing: ${missing.join(", ")}` : `${needed.size} files`,
);
check(
  "nothing else is precached",
  extra.length === 0,
  extra.length > 0 ? `unexpected: ${extra.join(", ")}` : `${precached.size} files`);
check(
  "every precached file exists in dist/",
  [...precached].every((file) => all.includes(file)),
  [...precached].filter((file) => !all.includes(file)).join(", "),
);
check(
  "no source map is precached",
  ![...precached].some((file) => file.endsWith(".map")),
);

/* ── the decision itself: languages are cached on first use, never at install ───────────────── */
const lazy = scripts.filter((file) => !staticClosure.has(file) && !precached.has(file)).sort();
check(
  "no lazily imported chunk is precached (a language is cached on first use)",
  lazy.every((file) => !precached.has(file)),
  `${lazy.length} lazy chunks, ${precached.size} precached`,
);

const expectedVersion = createHash("sha256")
  .update([...precached].sort().concat(workerTemplate).join("\n"))
  .digest("hex")
  .slice(0, 12);
check(
  "the version is the hash of that list plus the worker template",
  version === expectedVersion,
  `sw.js says ${version}, the sources say ${expectedVersion}`,
);

/* ── the measurement the ledger quotes ──────────────────────────────────────────────────────── */
const weight = (files) => {
  const buffers = files.map((file) => readFileSync(join(dist, file)));
  const raw = buffers.reduce((total, buffer) => total + buffer.length, 0);
  const gzipped = buffers.reduce((total, buffer) => total + gzipSync(buffer).length, 0);
  return `${(raw / 1024).toFixed(1)} kB raw / ${(gzipped / 1024).toFixed(1)} kB gzipped`;
};

console.log("");
const shellWeight = weight(precache);
const lazyWeight = weight(lazy);
console.log(`shell   ${precache.length} files: ${shellWeight}`);
console.log(`        ${precache.join(", ")}`);
console.log(
  `lazy    ${lazy.length} chunks: ${lazyWeight} — the 140 languages of D9, ` +
    `fetched on first use and cached then, never at install`,
);
console.log("");
console.log(failures === 0 ? "The offline shell and the build agree." : `${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
