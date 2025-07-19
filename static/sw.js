/* Service Worker universel pour sites Hugo */

// ✅ NOM DYNAMIQUE basé sur le domaine
const SITE_NAME = self.location.hostname.replace(/\./g, '-');
const CACHE_NAME = `hugo-site-${SITE_NAME}-v1`;

const urlsToCache = [
  '/', 
  '/css/style.compiled.css',
  '/js/main.compiled.js',
  '/fonts/Inter-400.woff2',
  '/fonts/Inter-600.woff2'
  // ✅ SUPPRIMÉ: offline.html
];

// Installation
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log(`Cache ouvert: ${CACHE_NAME}`);
        return cache.addAll(urlsToCache);
      })
  );
});

// Activation et nettoyage des anciens caches
self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (!cacheWhitelist.includes(cacheName)) {
            console.log('Suppression ancien cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// Stratégie de cache
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  
  // ✅ NOUVEAU: Skip requêtes non-GET
  if (request.method !== 'GET') {
    event.respondWith(fetch(request));
    return;
  }
  
  // Cache-first pour les assets statiques
  if (request.destination === 'style' || 
      request.destination === 'script' ||
      request.destination === 'font' ||
      request.destination === 'image') {
    event.respondWith(cacheFirst(request));
    return;
  }
  
  // Network-first pour le HTML
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }
  
  // Network-only pour les API
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request));
    return;
  }
  
  // Par défaut: network-first
  event.respondWith(networkFirst(request));
});

// Stratégies de cache
async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  
  if (cached) {
    return cached;
  }
  
  try {
    const response = await fetch(request);
    
    // ✅ CORRIGÉ: Vérifier que c'est GET avant de cacher
    if (response.ok && request.method === 'GET') {
      cache.put(request, response.clone());
    }
    
    return response;
  } catch (error) {
    console.error('Fetch failed:', error);
    throw error;
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    
    // ✅ CORRIGÉ: Vérifier que c'est GET avant de cacher
    if (response.ok && request.method === 'GET') {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    
    return response;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) {
      return cached;
    }
    
    // ✅ SIMPLIFIÉ: Pas de page offline, juste throw l'erreur
    throw error;
  }
}
