/* UltradianDrift service worker — offline-first static caching (0050). */
const CACHE = "ultradiandrift-v2";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        cache.addAll([
          "./",
          "./favicon.svg",
          "./favicon-light.svg",
          "./manifest.webmanifest",
          "./fonts/lexend-latin.woff2",
          "./fonts/lexend-latin-ext.woff2",
          "./fonts/atkinson-latin.woff2",
          "./fonts/atkinson-latin-ext.woff2",
          "./backgrounds/forest-stream.svg",
          "./backgrounds/misty-pines.svg",
          "./backgrounds/ocean-waves.svg",
          "./backgrounds/mountain-lake.svg",
          "./backgrounds/meadow.svg",
          "./backgrounds/rain-leaves.svg",
          "./backgrounds/desert-dunes.svg",
          "./backgrounds/night-sky.svg",
        ]),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      });
    }),
  );
});
