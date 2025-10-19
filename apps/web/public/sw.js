const CACHE_NAME = 'video-player-v1';
const STATIC_CACHE = 'video-static-v1';
const HLS_CACHE = 'video-hls-v1';

const STATIC_ASSETS = [
  'https://vjs.zencdn.net/8.6.1/video.min.js',
  'https://vjs.zencdn.net/8.6.1/video-js.css',
  'https://vjs.zencdn.net/8.6.1/lang/en.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(name => name !== STATIC_CACHE && name !== HLS_CACHE)
          .map(name => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;

  if (STATIC_ASSETS.some(asset => url.href.includes(asset))) {
    event.respondWith(
      caches.match(request)
        .then(response => response || fetch(request))
    );
    return;
  }

  if (url.pathname.includes('.ts') || url.pathname.includes('.m4s')) {
    event.respondWith(
      caches.open(HLS_CACHE)
        .then(cache => {
          return cache.match(request)
            .then(response => {
              const fetchPromise = fetch(request).then(fetchResponse => {
                if (fetchResponse.status === 200) {
                  cache.put(request, fetchResponse.clone());
                }
                return fetchResponse;
              });
              return response || fetchPromise;
            });
        })
    );
    return;
  }

  if (url.pathname.includes('.m3u8')) {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.status === 200) {
            const responseClone = response.clone();
            caches.open(HLS_CACHE)
              .then(cache => cache.put(request, responseClone));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }
});

const MAX_HLS_CACHE_SIZE = 100 * 1024 * 1024;

const limitCacheSize = async (cacheName, maxSize) => {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  let size = 0;
  const itemsToDelete = [];

  for (const request of keys) {
    const response = await cache.match(request);
    if (response) {
      const responseSize = response.headers.get('content-length') || 0;
      size += parseInt(responseSize, 10);

      if (size > maxSize) {
        itemsToDelete.push(request);
      }
    }
  }

  if (itemsToDelete.length > 0) {
    await Promise.all(itemsToDelete.map(request => cache.delete(request)));
  }
};

setInterval(() => {
  limitCacheSize(HLS_CACHE, MAX_HLS_CACHE_SIZE);
}, 60000);
