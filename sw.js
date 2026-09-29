// sw.js — Service Worker для PWA: мгновенная работа без интернета (в метро, оффлайн).
const CACHE_NAME = 'parket-cache-v1';
const API_CACHE = 'parket-api-v1';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/app.css',
  '/config/profiles.js',
  '/js/core.js',
  '/js/state.js',
  '/js/domain.js',
  '/js/cards.js',
  '/js/views.js',
  '/js/sheets.js',
  '/js/app.js',
  '/manifest.json',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-180.png',
  '/icons/icon-32.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((k) => {
          if (k !== CACHE_NAME && k !== API_CACHE) return caches.delete(k);
        })
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);

  // POST запросы не кешируем
  if (req.method !== 'GET') return;

  // Telegram CDN скрипт пропускаем напрямую
  if (url.hostname.includes('telegram.org')) return;

  // API запросы (/api/schedule): Network First с откатом к кешу
  if (url.pathname.startsWith('/api/schedule')) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(API_CACHE).then((cache) => cache.put(req, clone));
          }
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // Для остальных API (/api/state, /api/changes): сеть, без долгого кеширования
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(fetch(req).catch(() => caches.match(req)));
    return;
  }

  // Статические файлы и навигация: Cache First с фоновым обновлением (Stale-While-Revalidate)
  e.respondWith(
    caches.match(req).then((cached) => {
      const netFetch = fetch(req)
        .then((netRes) => {
          if (netRes.ok) {
            const clone = netRes.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return netRes;
        })
        .catch(() => {
          // Если навигация страницы и нет сети: отдаём закешированный index.html
          if (req.mode === 'navigate') {
            return caches.match('/index.html') || caches.match('/');
          }
        });

      return cached || netFetch;
    })
  );
});
