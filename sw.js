const CACHE_VERSION = 'kite-library-v1';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon.svg',
  './icon-maskable.svg'
];
const CDN_URLS = [
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => {
      const urls = [...APP_SHELL, ...CDN_URLS];
      return Promise.all(urls.map(url => cache.add(url).catch(err => console.warn('Cache skip:', url, err))));
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if(url.hostname.includes('firestore.googleapis.com') ||
     url.hostname.includes('identitytoolkit.googleapis.com') ||
     url.hostname.includes('securetoken.googleapis.com') ||
     url.hostname.includes('firebaseinstallations.googleapis.com') ||
     url.hostname.includes('firebaseapp.com')) return;

  if(url.origin === self.location.origin){
    event.respondWith(
      caches.match(req).then(cached => {
        if(cached) return cached;
        return fetch(req).then(res => {
          if(req.method === 'GET' && res.ok){
            const clone = res.clone();
            caches.open(CACHE_VERSION).then(c => c.put(req, clone));
          }
          return res;
        }).catch(() => {
          if(req.mode === 'navigate') return caches.match('./index.html');
        });
      })
    );
    return;
  }

  if(url.hostname === 'www.gstatic.com'){
    event.respondWith(
      caches.match(req).then(cached => {
        const network = fetch(req).then(res => {
          if(res.ok){ const clone = res.clone(); caches.open(CACHE_VERSION).then(c => c.put(req, clone)); }
          return res;
        }).catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  event.respondWith(fetch(req).catch(() => caches.match(req)));
});