/**
 * Service Worker for Al Ummah Now Video Player
 * Implements secure caching strategies with proper origin validation and CORS verification
 */

const CACHE_NAME = 'video-player-v2';
const STATIC_CACHE = 'video-static-v2';
const HLS_CACHE = 'video-hls-v2';

// Security: Define allowed origins for caching
const ALLOWED_ORIGINS = new Set([
  'https://vjs.zencdn.net',
  'https://bunny.net',
  'https://b-cdn.net', // Bunny.net CDN alternate domain
  self.location.origin
]);

// Static assets with integrity checks (SRI)
const STATIC_ASSETS = [
  {
    url: 'https://vjs.zencdn.net/8.6.1/video.min.js',
    integrity: null // Add actual SRI hash when available
  },
  {
    url: 'https://vjs.zencdn.net/8.6.1/video-js.css',
    integrity: null // Add actual SRI hash when available
  },
  {
    url: 'https://vjs.zencdn.net/8.6.1/lang/en.js',
    integrity: null // Add actual SRI hash when available
  }
];

// Cache size limits
const MAX_HLS_CACHE_SIZE = 100 * 1024 * 1024; // 100MB
const CACHE_CLEANUP_INTERVAL = 60000; // 1 minute

// Mutex for preventing race conditions
class CacheMutex {
  constructor() {
    this.locks = new Map();
  }

  async acquire(key) {
    while (this.locks.has(key)) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    this.locks.set(key, true);
  }

  release(key) {
    this.locks.delete(key);
  }

  async withLock(key, callback) {
    await this.acquire(key);
    try {
      return await callback();
    } finally {
      this.release(key);
    }
  }
}

const cacheMutex = new CacheMutex();
let cleanupIntervalId = null;

/**
 * Validates if an origin is allowed for caching
 */
function isOriginAllowed(url) {
  try {
    const origin = new URL(url).origin;
    return ALLOWED_ORIGINS.has(origin);
  } catch (error) {
    console.error('[SW] Invalid URL:', url, error);
    return false;
  }
}

/**
 * Validates CORS headers for cross-origin resources
 */
function validateCORSHeaders(response, requestOrigin) {
  if (!response || response.type === 'error') {
    return false;
  }

  // Same-origin requests are always valid
  if (response.type === 'basic') {
    return true;
  }

  // For cross-origin requests, check CORS headers
  if (response.type === 'cors') {
    const allowOrigin = response.headers.get('Access-Control-Allow-Origin');

    // Check if CORS allows our origin
    if (allowOrigin === '*' || allowOrigin === requestOrigin) {
      return true;
    }
  }

  // Opaque responses (no-cors) should not be cached for security
  if (response.type === 'opaque') {
    console.warn('[SW] Rejecting opaque response for security');
    return false;
  }

  return false;
}

/**
 * Safely fetches and validates a resource
 */
async function secureFetch(request, options = {}) {
  const url = typeof request === 'string' ? request : request.url;

  // Validate origin
  if (!isOriginAllowed(url)) {
    console.error('[SW] Blocked request to unauthorized origin:', url);
    return new Response('Unauthorized origin', { status: 403 });
  }

  try {
    const fetchOptions = {
      ...options,
      mode: 'cors', // Always use CORS mode for cross-origin requests
      credentials: 'omit' // Don't send cookies for cached resources
    };

    const response = await fetch(request, fetchOptions);

    // Validate CORS headers
    if (!validateCORSHeaders(response, self.location.origin)) {
      console.error('[SW] CORS validation failed for:', url);
      return new Response('CORS validation failed', { status: 403 });
    }

    return response;
  } catch (error) {
    console.error('[SW] Fetch error:', url, error);
    throw error;
  }
}

/**
 * Safely caches a response with validation
 */
async function safeCachePut(cache, request, response) {
  // Don't cache error responses
  if (!response || response.status < 200 || response.status >= 400) {
    return false;
  }

  // Don't cache opaque responses
  if (response.type === 'opaque') {
    console.warn('[SW] Not caching opaque response:', request.url);
    return false;
  }

  try {
    await cache.put(request, response);
    return true;
  } catch (error) {
    console.error('[SW] Cache put error:', error);
    return false;
  }
}

/**
 * Install event - cache static assets
 */
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker...');

  event.waitUntil(
    cacheMutex.withLock('install', async () => {
      try {
        const cache = await caches.open(STATIC_CACHE);

        // Fetch and validate each static asset
        const promises = STATIC_ASSETS.map(async (asset) => {
          try {
            const response = await secureFetch(asset.url);

            if (response.ok) {
              // TODO: Implement SRI validation when hashes are available
              await safeCachePut(cache, asset.url, response);
              console.log('[SW] Cached static asset:', asset.url);
            } else {
              console.error('[SW] Failed to cache static asset:', asset.url, response.status);
            }
          } catch (error) {
            console.error('[SW] Error caching static asset:', asset.url, error);
          }
        });

        await Promise.all(promises);
        await self.skipWaiting();
        console.log('[SW] Installation complete');
      } catch (error) {
        console.error('[SW] Installation error:', error);
        throw error;
      }
    })
  );
});

/**
 * Activate event - clean up old caches
 */
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker...');

  event.waitUntil(
    cacheMutex.withLock('activate', async () => {
      try {
        const cacheNames = await caches.keys();
        const validCaches = [STATIC_CACHE, HLS_CACHE];

        await Promise.all(
          cacheNames
            .filter(name => !validCaches.includes(name))
            .map(name => {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        );

        // Set up cache cleanup interval with proper cleanup
        if (cleanupIntervalId) {
          clearInterval(cleanupIntervalId);
        }

        cleanupIntervalId = setInterval(() => {
          limitCacheSize(HLS_CACHE, MAX_HLS_CACHE_SIZE).catch(error => {
            console.error('[SW] Cache cleanup error:', error);
          });
        }, CACHE_CLEANUP_INTERVAL);

        await self.clients.claim();
        console.log('[SW] Activation complete');
      } catch (error) {
        console.error('[SW] Activation error:', error);
        throw error;
      }
    })
  );
});

/**
 * Fetch event - handle requests with appropriate caching strategy
 */
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle GET requests
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  // Validate origin for all requests
  if (!isOriginAllowed(url.href)) {
    event.respondWith(
      new Response('Unauthorized origin', {
        status: 403,
        headers: { 'Content-Type': 'text/plain' }
      })
    );
    return;
  }

  // Strategy 1: Cache First for static assets
  if (STATIC_ASSETS.some(asset => url.href === asset.url)) {
    event.respondWith(
      cacheMutex.withLock(`fetch-static-${url.href}`, async () => {
        try {
          const cache = await caches.open(STATIC_CACHE);
          const cachedResponse = await cache.match(request);

          if (cachedResponse) {
            return cachedResponse;
          }

          const response = await secureFetch(request);

          if (response.ok) {
            await safeCachePut(cache, request, response.clone());
          }

          return response;
        } catch (error) {
          console.error('[SW] Static asset fetch error:', error);
          return new Response('Network error', { status: 503 });
        }
      })
    );
    return;
  }

  // Strategy 2: Stale While Revalidate for HLS segments
  if (url.pathname.includes('.ts') || url.pathname.includes('.m4s')) {
    event.respondWith(
      cacheMutex.withLock(`fetch-segment-${url.href}`, async () => {
        try {
          const cache = await caches.open(HLS_CACHE);
          const cachedResponse = await cache.match(request);

          // Return cached version immediately if available
          if (cachedResponse) {
            // Revalidate in the background
            secureFetch(request)
              .then(response => {
                if (response.ok) {
                  safeCachePut(cache, request, response);
                }
              })
              .catch(error => {
                console.warn('[SW] Background revalidation failed:', error);
              });

            return cachedResponse;
          }

          // No cache, fetch from network
          const response = await secureFetch(request);

          if (response.ok) {
            await safeCachePut(cache, request, response.clone());
          }

          return response;
        } catch (error) {
          console.error('[SW] HLS segment fetch error:', error);

          // Try to return stale cache if network fails
          const cache = await caches.open(HLS_CACHE);
          const staleResponse = await cache.match(request);

          if (staleResponse) {
            console.warn('[SW] Returning stale HLS segment due to network error');
            return staleResponse;
          }

          return new Response('Network error', { status: 503 });
        }
      })
    );
    return;
  }

  // Strategy 3: Network First for manifests
  if (url.pathname.includes('.m3u8')) {
    event.respondWith(
      cacheMutex.withLock(`fetch-manifest-${url.href}`, async () => {
        try {
          const response = await secureFetch(request);

          if (response.ok) {
            const cache = await caches.open(HLS_CACHE);
            await safeCachePut(cache, request, response.clone());
            return response;
          }

          // Network failed, try cache
          const cache = await caches.open(HLS_CACHE);
          const cachedResponse = await cache.match(request);

          if (cachedResponse) {
            console.warn('[SW] Using cached manifest due to network error');
            return cachedResponse;
          }

          return response;
        } catch (error) {
          console.error('[SW] Manifest fetch error:', error);

          // Network failed, try cache
          try {
            const cache = await caches.open(HLS_CACHE);
            const cachedResponse = await cache.match(request);

            if (cachedResponse) {
              console.warn('[SW] Using cached manifest due to network error');
              return cachedResponse;
            }
          } catch (cacheError) {
            console.error('[SW] Cache access error:', cacheError);
          }

          return new Response('Network error', { status: 503 });
        }
      })
    );
    return;
  }

  // Default: pass through other requests without caching
  event.respondWith(fetch(request));
});

/**
 * Limits cache size with mutex protection
 */
async function limitCacheSize(cacheName, maxSize) {
  return cacheMutex.withLock(`cleanup-${cacheName}`, async () => {
    try {
      const cache = await caches.open(cacheName);
      const keys = await cache.keys();

      if (keys.length === 0) {
        return;
      }

      // Calculate total size and collect metadata
      const cacheItems = [];
      let totalSize = 0;

      for (const request of keys) {
        const response = await cache.match(request);

        if (response) {
          const size = parseInt(response.headers.get('content-length') || '0', 10);
          const lastModified = response.headers.get('last-modified');
          const timestamp = lastModified ? new Date(lastModified).getTime() : Date.now();

          cacheItems.push({
            request,
            size,
            timestamp
          });

          totalSize += size;
        }
      }

      // If within limit, nothing to do
      if (totalSize <= maxSize) {
        return;
      }

      // Sort by timestamp (oldest first)
      cacheItems.sort((a, b) => a.timestamp - b.timestamp);

      // Remove oldest items until under limit
      const itemsToDelete = [];
      let sizeToFree = totalSize - maxSize;

      for (const item of cacheItems) {
        if (sizeToFree <= 0) {
          break;
        }

        itemsToDelete.push(item.request);
        sizeToFree -= item.size;
      }

      // Delete items
      if (itemsToDelete.length > 0) {
        console.log(`[SW] Removing ${itemsToDelete.length} items from ${cacheName} to free space`);

        await Promise.all(
          itemsToDelete.map(request => cache.delete(request))
        );
      }
    } catch (error) {
      console.error('[SW] Cache size limit error:', error);
    }
  });
}

/**
 * Message event handler for communication with clients
 */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

  if (event.data && event.data.type === 'CLEAR_CACHE') {
    cacheMutex.withLock('clear-cache', async () => {
      try {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map(name => caches.delete(name)));

        event.ports[0].postMessage({ success: true });
      } catch (error) {
        console.error('[SW] Clear cache error:', error);
        event.ports[0].postMessage({ success: false, error: error.message });
      }
    });
  }
});

/**
 * Clean up on service worker termination
 */
self.addEventListener('beforeunload', () => {
  if (cleanupIntervalId) {
    clearInterval(cleanupIntervalId);
    cleanupIntervalId = null;
  }
});

console.log('[SW] Service Worker loaded with security controls');