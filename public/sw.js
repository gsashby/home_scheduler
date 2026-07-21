// Minimal hand-rolled service worker (no build-step PWA plugin — Next.js 16
// builds with Turbopack by default, and the usual webpack-based PWA plugins
// don't fit that cleanly). Three jobs: (1) offline read access to the app
// shell per NFR #6, (2) offline read access to previously-loaded family
// data (see handleSupabaseRest below), (3) display web push notifications
// for the daily brief, deadline alerts, and parent nudges per Must-have #10.

const CACHE_NAME = "home-scheduler-shell-v1";
const API_CACHE_NAME = "home-scheduler-api-v1";
const APP_SHELL = ["/", "/offline.html", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME && key !== API_CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      ),
  );
  self.clients.claim();
});

// Every (app) tab re-fetches its own data on mount via the browser Supabase
// client (see 03-frontend.md), straight to Supabase's REST API — cross-
// origin, so the same-origin check below skips it entirely by default.
// Without this, going offline doesn't just fail to refresh data: each
// tab's own useEffect load() calls reject, and every page sets its state
// to `data ?? []`, silently blanking out whatever the cached page shell
// had just shown. This intercepts those specific reads only (not Auth,
// not Realtime's websocket, not Edge Functions) so a failed fetch falls
// back to the last successful response instead.
//
// Cache keys are salted with a hash of the Authorization header, not just
// the URL — PostgREST scopes rows by the caller's JWT via RLS, not by
// anything in the URL/query itself, so two different signed-in users
// hitting the same table+filter would otherwise share one cache entry.
// This matters most on a shared family device where more than one person
// might use the same browser profile.
async function cacheKeyFor(request) {
  const auth = request.headers.get("Authorization") ?? "";
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(auth),
  );
  const hash = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${request.url}#auth=${hash}`;
}

async function handleSupabaseRest(request) {
  const cache = await caches.open(API_CACHE_NAME);
  const key = await cacheKeyFor(request);
  try {
    const response = await fetch(request);
    // Awaited, not fire-and-forget: a service worker can be killed the
    // instant the promise passed to respondWith() resolves, so an
    // un-awaited cache write here is a real race, not just a style nit
    // (this exact bug was hiding in the navigation handler below until a
    // Playwright test caught it — see 07-project-status.md).
    if (response.ok) await cache.put(key, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(key);
    if (cached) return cached;
    throw err;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    // Cross-origin: everything except Supabase's own REST reads (Auth,
    // Realtime, Edge Functions, chrome-extension:// resources injected by
    // extensions like password managers, etc) is left to the browser's
    // default handling, same as before.
    if (url.pathname.startsWith("/rest/v1/")) {
      event.respondWith(handleSupabaseRest(request));
    }
    return;
  }

  // Navigations: network-first so signed-in users always see fresh data
  // when online, falling back to the cached shell (or offline page) when not.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          const cache = await caches.open(CACHE_NAME);
          // Awaited for the same reason as handleSupabaseRest above --
          // an un-awaited cache.put() here can lose the race against the
          // worker being killed right after respondWith()'s promise
          // resolves, so a page visited while online might never
          // actually end up cached for later offline use.
          await cache.put(request, response.clone());
          return response;
        } catch {
          return (await caches.match(request)) || caches.match("/offline.html");
        }
      })(),
    );
    return;
  }

  // Static assets: cache-first.
  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
      }
      return response;
    })(),
  );
});

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "Home Scheduler", body: event.data.text() };
  }

  const { title = "Home Scheduler", body, url = "/" } = payload;

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        const existing = clients.find((c) => c.url.includes(url));
        if (existing) return existing.focus();
        return self.clients.openWindow(url);
      }),
  );
});
