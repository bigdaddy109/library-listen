/* Shell-only cache. Audiobook files are never cached here. */
const CACHE = "library-listen-shell-v20";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css?v=20",
  "./app.js?v=20",
  "./immune-cards.js?v=20",
  "./manifest.webmanifest",
  "./icon.svg?v=20",
  "./apple-touch-icon.png?v=20",
  "./concepts/immune/skin.jpg",
  "./concepts/immune/bacteria.jpg",
  "./concepts/immune/inflammation.jpg",
  "./concepts/immune/neutrophil.jpg",
  "./concepts/immune/macrophage.jpg",
  "./concepts/immune/complement.jpg",
  "./concepts/immune/cytokines.jpg",
  "./concepts/immune/dendritic.jpg",
  "./concepts/immune/lymph-node.jpg",
  "./concepts/immune/thymus.jpg",
  "./concepts/immune/t-cell.jpg",
  "./concepts/immune/b-cell.jpg",
  "./concepts/immune/mucosa.jpg",
  "./concepts/immune/virus.jpg",
  "./concepts/immune/interferon.jpg",
  "./concepts/immune/natural-killer.jpg",
  "./concepts/immune/mast-cell.jpg",
  "./concepts/immune/memory.jpg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Always network-first for HTML so logo/UI updates show up.
  if (request.mode === "navigate" || url.pathname.endsWith(".html") || url.pathname.endsWith("/")) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const fetched = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || fetched;
    })
  );
});
