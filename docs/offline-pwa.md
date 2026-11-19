# The offline app — the manifest, the service worker, and what "offline" means (Task 8)

Task 8's spec is three sentences: *"Add PWA manifest and service worker caching for static assets.
Optionally bundle as a single portable HTML file. Verify offline load path."* This document is what
those sentences turned into, with the measurements that decided each of them.

| Artifact | Role |
|---|---|
| `public/manifest.webmanifest` | The installable app: name, icons, standalone window, N++'s chrome grey as its colour |
| `public/icon-192.png`, `icon-512.png`, `icon-maskable-512.png` | Raster icons, regenerable with `scripts/gen-pwa-icons.py` |
| `src/pwa/service-worker.js` | The worker itself: what is precached, what is cached on use, what is never touched |
| `src/pwa/register.ts` | Registration, **production builds only** |
| `vite.config.ts` → `pwaOfflineShell()` | Emits `dist/sw.js` with the build's own precache list and version |
| `scripts/check-precache.mjs` | Re-derives both sets from `dist/` and prints their measured weight |
| `scripts/verify-task8.py` | The acceptance check: manifest, installability, and three offline loads |

## What "offline" means, and what it deliberately does not

The first load is the shell; the languages are not. D9 keeps all 140 languages in lazily imported
chunks, and precaching them would put the whole language set on the wire before the first paint.
So the worker draws a line:

| | Files | Weight (measured by `scripts/check-precache.mjs`) | When it is fetched |
|---|---|---|---|
| **Shell** | 9 | **461.3 kB raw / 151.3 kB gzipped** | At install, and again when a new build replaces it |
| **Languages and their runtimes** | 126 chunks | **1 227.8 kB raw / 481.9 kB gzipped** | The first time a document using one is opened, then cached |

The shell list is *derived*, never hand-kept: `pwaOfflineShell()` reads the emitted `index.html`,
follows the entry chunks' **static** import closure, adds the `public/` files the manifest names, and
writes that list into `dist/sw.js`. Rename a chunk and the list follows, because the file names
carry their hashes. `scripts/check-precache.mjs` re-derives the same two sets from `dist/` alone and
fails if they disagree with what the worker carries — including on the decision itself: *no lazily
imported chunk may be in the precache*.

The consequence, stated plainly because it is the honest edge of this design: **a language that was
never opened while online is not available offline.** The app reports that rather than pretending
(see "A language the page cannot fetch", below).

## The policy

| Request | What happens |
|---|---|
| A navigation in scope | The precached `index.html`, from the cache; the network only if the cache is somehow empty |
| Any other same-origin `GET` | Cache first; on a miss, fetch, store if the response is a basic 200, return it |
| `POST`/`PUT`/…, `Range`, `cache: "no-store"`, cross-origin | Left alone — the worker gets out of the way |
| `sw.js` itself | Never cached: a worker that pins the version it intends to replace can never update |

Everything lands in **one cache whose name carries the build hash** (`npp-web-<version>`), and
`activate` deletes the caches of earlier builds. That is not tidiness: a cached language chunk
statically imports the shared runtime chunks *of its own build*, so serving a new shell beside an old
language chunk would put two module graphs in one page. One cache, one build, always.

There is no `skipWaiting`. An update installs and waits until the app is next opened, which keeps a
half-updated module graph impossible; the version in the cache name is what makes the replacement
atomic.

## The measurements that shaped it

Each of these changed the design, and each is re-runnable rather than remembered.

**1. `clients.claim()` belongs in `activate`, not `install`.** Called during install it rejects with
an `InvalidStateError`, which rejects the *install*: the worker is discarded while **its cache stays
filled**, so the app looks offline-capable and has nothing to serve from. That is exactly the failure
this task exists to prevent, and it was caught by the first probe run, not by review.

**2. There is no in-page retry for a failed grammar — measured, then removed.** The first version
retried on the browser's `online` event and when the document came forward again. With the network
cut, opening an uncached language fails; with the network back, both retries failed *again* and the
server log never moved: not one request for twelve seconds of polling, because the failed module
fetch (a shared chunk, preloaded by Vite's import helper) stays memoised for the life of the
document. A reload gets a fresh module map, loads the grammar and paints the document. So the notice
offers the remedy that works — a reload — instead of promising one that does not, and the copy says
which is which. `scripts/verify-task8.py` §6 is that measurement in re-runnable form.

**3. "Offline" is checked two ways, and neither is a proxy.** `context.set_offline(True)` is the
browser being told there is no network; stopping the HTTP server is the network being *gone*. In
both, the check reads CDP's own `Network.responseReceived.fromServiceWorker` for every response
(it must be `true` for all of them), asserts the server's request log did not grow, and — because a
reload with the server stopped could otherwise be satisfied by the browser's HTTP cache — the server
sends `Cache-Control: no-cache` so that cache can never stand in for the worker.

**4. Installability is Chrome's verdict, not ours.** `Page.getInstallabilityErrors` comes back
empty; `Page.getAppManifest` reports no manifest errors and Chrome's own parse of the file
(`display: kStandalone`, `themeColor: rgba(240,240,240,1)`, both icons) — asserted in that
vocabulary, because it is Chrome's understanding that matters. The check also compares the manifest
against itself (exact fields, and icons whose PNG sizes really are what they declare).

**5. `navigator.storage.persist()` answered `false`** in the check's environment — a fresh profile,
no engagement, not installed. It is reported, never asserted: Chrome answers that call from its own
heuristics (engagement, installed-PWA status), which is exactly why `src/storage/persistent-storage.ts`
reports the answer instead of assuming it (risk R6).

**6. A language recovered by a reload may come from the browser's own caches.** Measured: after the
reload that fixed a failed grammar, the document highlighted *without* a request reaching the server
and *without* the chunk appearing in the worker's cache. The app promises the outcome a user
experiences — "used once, there afterwards" — and not the mechanism, because it controls only one of
those caches. The Python round trip (§3 → §4 of the check) does go through the worker: opening a
language normally caches it.

## The single portable HTML file: measured, then declined

The plan's step 2 says "optionally". It was measured rather than assumed:

* A build with `inlineDynamicImports` and the shell fused into one document produces
  **`index.html` at 1 699.9 kB** (1 711.3 kB with the manifest and icons), because fusing the graph
  means giving up D9's laziness: all 140 languages are in the file.
* Served over HTTP it works — the editor mounts, one file, no errors.
* Opened from disk (`file://`) it loses the things that make this an editor:
  * **OPFS throws** `SecurityError: … unsafe for access within a Web app` → no `backup/`, so unsaved
    work has no protection (Task 7's whole point).
  * **Service worker registration is refused** — `The URL protocol of the current origin ('null') is
    not supported` → no offline, no install, no app shell.
  * **The pickers reject** (`AbortError`) → File ▸ Open cannot return a file.
  * `isSecureContext` is `true` and IndexedDB/localStorage work, which is *not* enough: file I/O and
    persistence are the app.
  * The capability check sees the pickers' *presence* on `file://` and therefore shows no notice, so
    the failure surfaces as an error dialog at the first Open instead. Recorded here; not fixed,
    because the single-file build is not shipped.

So: the installable PWA **is** the portable artifact. A file:// build would be a viewer with no
storage, no file I/O and no offline cache, and 1.7 MB of languages nobody asked for.

## Running the evidence

```bash
npm run build                        # emits dist/sw.js; prints the version and both sets
node scripts/check-precache.mjs      # re-derives them from dist/ and prints the weights
python3 scripts/verify-task8.py      # builds, serves dist/ itself, drives Chrome (56 checks)
```

`verify-task8.py` needs no dev server (the dev server has no worker: registration is PROD-only,
because a worker caching unbundled dev modules would serve yesterday's code through a hot reload).
It does need Chrome for Playwright, Pillow (icon pixel sizes) and tesseract (OCR of the notice).

## Limits of this verification

* The check proves the app is installable *by Chrome's criteria* (`Page.getInstallabilityErrors`);
  it does not install it. Installation is user-gated UI, and `persist()`'s answer above is the
  visible consequence of not being an installed app.
* "Offline" is verified with the network removed on this machine. Nothing here claims anything about
  a mobile browser's storage eviction policy — that is D12's territory, and D12 keeps phones out of
  the MVP.
* The service worker is exercised in headless Chrome only. The one behaviour that could differ is
  the browser's own cache bookkeeping in measurement 6, which is why the app promises the outcome
  and not the mechanism.

## Plugins and the cache

A plugin's source lives in IndexedDB (the `plugins` store, DB version 3), never in the build, so a
plugin is offline by construction: install it while online and it loads with the network gone. Plugin
code is not part of the precache and never will be — it is imported from a `blob:` URL, which the
worker never sees, so `scripts/check-precache.mjs`'s shell count does not move because of plugins.
There is also no cache-versioning question when a plugin is updated: the stored source text changes,
and the next enable imports a fresh module. `scripts/verify-task-plugins.py` proves the outcome the
hard way — it stops its server, reloads, and runs a plugin command.
