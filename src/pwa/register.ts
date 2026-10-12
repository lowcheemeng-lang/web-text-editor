/*
 * Registering the offline shell (Task 8).
 *
 * Registration is **production only**, and the reason is a real one rather than a habit: the dev
 * server serves the app as unbundled ES modules (`/src/main.ts`, `/@vite/client`, HMR sockets),
 * and a worker caching those URLs would serve yesterday's modules while Vite reports a hot update —
 * a class of confusion this project has no reason to invite. The dev server also has no `sw.js`.
 *
 * The worker itself is `src/pwa/service-worker.js`, emitted as `dist/sw.js` with its precache list
 * and version injected; its header explains what it does and does not cache.
 */

/** What the browser says about the offline shell right now — for a human, and for a check. */
export interface OfflineShellStatus {
  /** `navigator.serviceWorker` exists at all — false on `file://` and in older browsers. */
  supported: boolean;
  /** This page was served by a worker (a reload after the first visit). */
  controlled: boolean;
  /** `installing` / `waiting` / `activating` / `activated` / `redundant`, when there is one. */
  state: string | null;
  scope: string | null;
  /** The build the active worker belongs to — the `npp-web-<version>` cache it fills. */
  version: string | null;
  /** Every cache this origin holds, with its entry count. The shell's is `npp-web-<version>`. */
  caches: { name: string; entries: number }[];
}

/** The cache-name prefix `service-worker.js` writes; kept in step with it by `verify-task8.py`. */
const CACHE_PREFIX = "npp-web-";

/**
 * Ask the browser to install the offline shell. Called from `main.ts` after the app is up, so
 * the first paint is never waiting on a network round trip for a worker.
 */
export async function registerOfflineShell(): Promise<void> {
  if (!("serviceWorker" in navigator)) return; // no secure context, or no worker support
  try {
    const registration = await navigator.serviceWorker.register(
      new URL("sw.js", document.baseURI),
      { scope: "./" },
    );
    console.info(
      `[task 8] offline shell registered (scope ${registration.scope}); ` +
        `the app will load without a network from the next visit`,
    );
  } catch (error) {
    // Not fatal, and deliberately not a dialog: everything still works online. A user who
    // wants to know why gets it in the console.
    console.warn("[task 8] offline shell could not be registered", error);
  }
}

/** Read the current state of the offline shell — never assumed, always from the browser. */
export async function offlineShellStatus(): Promise<OfflineShellStatus> {
  const supported = typeof navigator !== "undefined" && "serviceWorker" in navigator;
  if (!supported) {
    return { supported: false, controlled: false, state: null, scope: null, version: null, caches: [] };
  }

  const registration = await navigator.serviceWorker.getRegistration();
  const caches: { name: string; entries: number }[] = [];
  for (const name of await globalThis.caches.keys()) {
    const cache = await globalThis.caches.open(name);
    caches.push({ name, entries: (await cache.keys()).length });
  }
  const shell = caches.find((entry) => entry.name.startsWith(CACHE_PREFIX));

  return {
    supported: true,
    controlled: navigator.serviceWorker.controller !== null,
    state: registration?.active?.state ?? null,
    scope: registration?.scope ?? null,
    version: shell ? shell.name.slice(CACHE_PREFIX.length) : null,
    caches,
  };
}
