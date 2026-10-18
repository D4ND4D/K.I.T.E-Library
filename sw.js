const CACHE_VERSION = 'kite-library-v7';


const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './icon-180.png'
];


const CDN_URLS = [
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js'
];

const NAV_TIMEOUT_MS = 4000;

/* ---------- helpers ---------- */


async function cacheModuleTree(cache, url, seen) {
  if (seen.has(url)) return;
  seen.add(url);
  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    console.warn('Cache skipped:', url, err);
    return;
  }
  if (!res || !res.ok) return;
  await cache.put(url, res.clone());
  const text = await res.text();
  const re = /(?:from|import)\s*\(?\s*["']([^"']+?\.js)["']/g;
  const deps = [];
  let m;
  while ((m = re.exec(text))) {
    try {
      const dep = new URL(m[1], url);
      if (dep.hostname === 'www.gstatic.com') deps.push(dep.href);
    } catch (e) { /* ignore bad specifier */ }
  }
  await Promise.all(deps.map((d) => cacheModuleTree(cache, d, seen)));
}

function putInCache(req, res) {
  if (req.method === 'GET' && res && res.ok) {
    const clone = res.clone();
    caches.open(CACHE_VERSION).then((c) => c.put(req, clone)).catch(() => {});
  }
  return res;
}


function fetchWithTimeout(req, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    fetch(req).then(
      (res) => { clearTimeout(timer); resolve(res); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

/* ---------- install / activate ---------- */

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(async (cache) => {
      await Promise.all(
        APP_SHELL.map((url) =>
          // cache
          cache.add(new Request(url, { cache: 'reload' }))
            .catch((err) => console.warn('Cache skipped:', url, err))
        )
      );
      const seen = new Set();
      await Promise.all(CDN_URLS.map((url) => cacheModuleTree(cache, url, seen)));
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* ---------- fetch ---------- */

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  
  if (url.hostname.includes('firestore.googleapis.com') ||
      url.hostname.includes('identitytoolkit.googleapis.com') ||
      url.hostname.includes('securetoken.googleapis.com') ||
      url.hostname.includes('firebaseinstallations.googleapis.com') ||
      url.hostname.includes('firebaseapp.com')) {
    return;
  }

  
  if (req.mode === 'navigate') {
    event.respondWith(
      fetchWithTimeout(req, NAV_TIMEOUT_MS)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_VERSION).then((c) => c.put('./index.html', clone)).catch(() => {});
          }
          return res;
        })
        .catch(async () => {
          return (await caches.match(req, { ignoreSearch: true })) ||
                 (await caches.match('./index.html')) ||
                 (await caches.match('./')) ||
                 Response.error();
        })
    );
    return;
  }

  
  if (url.origin === self.location.origin && /\/(manifest\.json|icon[^/]*\.(png|svg))$/.test(url.pathname)) {
    event.respondWith(
      fetchWithTimeout(req, NAV_TIMEOUT_MS)
        .then((res) => putInCache(req, res))
        .catch(() => caches.match(req).then((r) => r || Response.error()))
    );
    return;
  }

  
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const network = fetch(req).then((res) => putInCache(req, res)).catch(() => null);
        if (cached) { event.waitUntil(network); return cached; }
        return network.then((res) => res || Response.error());
      })
    );
    return;
  }

  
  if (url.hostname === 'www.gstatic.com') {
    event.respondWith(
      caches.match(req).then((cached) => {
        const network = fetch(req).then((res) => putInCache(req, res)).catch(() => null);
        if (cached) { event.waitUntil(network); return cached; }
        return network.then((res) => res || Response.error());
      })
    );
    return;
  }

  // Everything else: network first, fall back to cache.
  event.respondWith(
    fetch(req).catch(() => caches.match(req).then((r) => r || Response.error()))
  );
});
