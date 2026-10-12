/*
 * Notepad++ Web — the offline shell (Task 8).
 *
 * A **classic** service worker: it is emitted verbatim by the `pwa-offline-shell` plugin in
 * `vite.config.ts`, which replaces the two placeholders below with the build's own asset list
 * and a hash of it. That is why this file is plain JavaScript and why it imports nothing — a
 * module worker would need `{ type: "module" }` registration and a chunk graph of its own, for
 * no benefit: the policy below is sixty lines and the version is injected.
 *
 * WHAT "OFFLINE" MEANS HERE, AND WHAT IT DOES NOT
 *
 * The editor's first load is ~150 kB gzip of shell (`index.html`, the app chunk, `editor-core`,
 * the stylesheet, the manifest and the icons) plus **127 lazily imported chunks** — the 140
 * languages of D9 and the Lezer runtimes they share, 1.23 MB raw. Precaching all of them would
 * put the whole language set on the wire before the first paint, and D9's entire point is that a
 * language costs nothing until it is opened. So the split is deliberate:
 *
 *   shell            precached at install (this file's PRECACHE list, generated from the build)
 *   everything else  cache-first, **filled on first use**: the chunk the app fetches for a
 *                    language is stored at the moment it fetches it — normally the first time a
 *                    document using that language is opened — and is available offline afterwards
 *
 * The consequence, stated plainly because it is the honest edge of this design: **a language that
 * was never opened while online is not available offline.** The app reports that rather than
 * pretending (`workspace.ts` shows a notice and offers the one remedy that works, a reload).
 * A measured nuance, so the promise above is not read as wider than it is: a language that only
 * ever loaded *after* a failed first attempt can be served from the browser's own caches rather
 * than from this one — `docs/offline-pwa.md` records that limit.
 *
 * Everything cached goes in one cache whose name carries the build hash, so a new build starts a
 * fresh cache and `activate` deletes the old one. That is not tidiness: a cached language chunk
 * statically imports the shared runtime chunk of *its* build, so mixing a new shell with an old
 * language chunk would load two module graphs into one page. One cache, one build, always.
 *
 * There is no background sync, no push, no cross-origin caching (D1: there is nothing to talk to),
 * and no `skipWaiting`: an update installs and waits until the app is next opened, which is what
 * keeps a half-updated module graph (above) impossible.
 */

/** The build this worker belongs to: a hash of the file names below, injected at build time. */
const VERSION = "__NPP_PWA_VERSION__";
/** Everything reachable from `index.html` without a dynamic import — injected at build time. */
const PRECACHE = __NPP_PWA_PRECACHE__;

const CACHE_PREFIX = "npp-web-";
const CACHE_NAME = `${CACHE_PREFIX}${VERSION}`;
/** The scope this worker controls, absolute — `./` resolves to the app's own directory. */
const SCOPE = new URL("./", self.location).href;
/** The one document that is the app. */
const SHELL = "index.html";
const SHELL_URL = new URL(SHELL, SCOPE).href;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      // `cache: "reload"` so the precache holds what the server sent now, not what the
      // browser's HTTP cache happens to be holding. A single failure rejects, and the
      // worker is not installed: a cache that is merely *almost* complete would look
      // offline-capable and fail on exactly the file that was missing.
      await Promise.all(
        PRECACHE.map((path) => cache.add(new Request(new URL(path, SCOPE).href, { cache: "reload" }))),
      );
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        // Only this app's own caches: another project on the same origin keeps its own.
        if (name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME) await caches.delete(name);
      }
      // Take over pages that loaded before this worker existed (the first visit), so the app
      // gains its offline subresources without needing a reload first.
      //
      // This belongs here and *not* in `install`: `clients.claim()` rejects with
      // InvalidStateError while the worker is still installing, which rejects the install
      // itself — measured, and worth writing down, because the leftover state is the worst
      // kind: the cache is filled, the app looks offline-capable, and there is no worker to
      // serve from it.
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  // Anything that is not a plain same-origin GET is not this worker's business: the app never
  // POSTs, is never cross-origin, and a range request must keep its partial semantics.
  if (request.method !== "GET") return;
  if (request.cache === "no-store") return;
  if (request.headers.has("range")) return;
  if (new URL(request.url).origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(shell());
    return;
  }
  event.respondWith(cached(request));
});

/** A navigation is always the app, in scope, from the cache when it is there. */
async function shell() {
  const cache = await caches.open(CACHE_NAME);
  const hit = await cache.match(SHELL_URL);
  // Only reachable if the install never completed or the cache was cleared: be an ordinary
  // fetch and let the browser report the failure it would have reported anyway.
  return hit ?? fetch(SHELL_URL);
}

/** Cache first, and fill the cache from the network — a language is cached when first opened. */
async function cached(request) {
  const cache = await caches.open(CACHE_NAME);
  const hit = await cache.match(request);
  if (hit) return hit;

  const response = await fetch(request);
  if (response.ok && response.type === "basic") {
    // A failed write (quota, eviction mid-flight) must not turn a successful fetch into an
    // error for the page that asked for it.
    cache.put(request, response.clone()).catch(() => {});
  }
  return response;
}
