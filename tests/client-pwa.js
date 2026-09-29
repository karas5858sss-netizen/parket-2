const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const ok = (name, cond, info) => console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (cond ? '' : '   ' + JSON.stringify(info)));

// 1. Проверка manifest.json
const manifestPath = path.join(ROOT, 'manifest.json');
ok('файл manifest.json существует', fs.existsSync(manifestPath));
let manifest = {};
try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
} catch (e) {}

ok('manifest: name и short_name заданы', manifest.name && manifest.short_name);
ok('manifest: display standalone для запуска без рамок браузера', manifest.display === 'standalone');
ok('manifest: start_url задан', manifest.start_url === '/');
ok('manifest: заданы иконки 192x192 и 512x512', Array.isArray(manifest.icons) && manifest.icons.some(i => i.sizes === '192x192') && manifest.icons.some(i => i.sizes === '512x512'));
ok('manifest: есть maskable иконка для Android адаптивных иконок', manifest.icons.some(i => i.purpose && i.purpose.includes('maskable')));

// 2. Проверка иконок
const icons = ['icon.svg', 'icon-192.png', 'icon-512.png', 'icon-180.png', 'icon-32.png'];
for (const icon of icons) {
  const ip = path.join(ROOT, 'icons', icon);
  ok('иконка ' + icon + ' существует и не пустая', fs.existsSync(ip) && fs.statSync(ip).size > 100);
}

// 3. Проверка тегов в index.html
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
ok('index.html: подключен manifest.json', indexHtml.includes('rel="manifest"'));
ok('index.html: заданы iOS теги apple-mobile-web-app-capable и title', indexHtml.includes('apple-mobile-web-app-capable') && indexHtml.includes('apple-mobile-web-app-title'));
ok('index.html: подключена apple-touch-icon для домашнего экрана iPhone', indexHtml.includes('rel="apple-touch-icon"'));
ok('index.html: есть регистрация Service Worker', indexHtml.includes('serviceWorker.register'));

// 4. Проверка sw.js: синтаксис и структуры
const swPath = path.join(ROOT, 'sw.js');
ok('файл sw.js существует', fs.existsSync(swPath));
const swContent = fs.readFileSync(swPath, 'utf8');
ok('sw.js: содержит обработчики install, activate и fetch', swContent.includes('install') && swContent.includes('activate') && swContent.includes('fetch'));
ok('sw.js: кеширует статические файлы и манифест', swContent.includes('/index.html') && swContent.includes('/manifest.json'));
ok('sw.js: версия кэша обновлена до parket-cache-v2', swContent.includes('parket-cache-v2'));

// 5. Полноценное тестирование жизненного цикла Service Worker в изолированном контексте
const vm = require('vm');

(async () => {
  const listeners = {};
  const cacheStorage = new Map(); // cacheName -> Map(url, response)

  const normKey = (r) => {
    const s = typeof r === 'string' ? r : (r && r.url) || '';
    try { return new URL(s).pathname; } catch (e) { return s; }
  };

  const makeCache = (name) => {
    if (!cacheStorage.has(name)) cacheStorage.set(name, new Map());
    const m = cacheStorage.get(name);
    return {
      addAll: async (urls) => { urls.forEach((u) => m.set(u, { status: 200, ok: true, url: u, text: () => Promise.resolve('cached ' + u) })); },
      put: async (req, res) => { const k = typeof req === 'string' ? req : req.url; m.set(k, res); },
      match: async (req) => {
        const k = typeof req === 'string' ? req : req.url;
        const p = normKey(k);
        return m.get(k) || m.get(p) || null;
      },
    };
  };

  const cachesMock = {
    open: async (name) => makeCache(name),
    keys: async () => Array.from(cacheStorage.keys()),
    delete: async (name) => { const has = cacheStorage.has(name); cacheStorage.delete(name); return has; },
    match: async (req) => {
      const k = typeof req === 'string' ? req : req.url;
      const p = normKey(k);
      for (const m of cacheStorage.values()) {
        if (m.has(k)) return m.get(k);
        if (m.has(p)) return m.get(p);
      }
      return null;
    },
  };

  let skipWaitingCalled = false;
  let clientsClaimCalled = false;
  let networkFetchImpl = async () => ({ status: 200, ok: true, clone() { return this; } });

  const swSandbox = {
    self: {
      addEventListener: (type, fn) => { listeners[type] = fn; },
      skipWaiting: async () => { skipWaitingCalled = true; },
      clients: { claim: async () => { clientsClaimCalled = true; } },
    },
    caches: cachesMock,
    fetch: async (req) => networkFetchImpl(req),
    URL: global.URL,
    Promise,
    console,
  };

  vm.createContext(swSandbox);
  vm.runInContext(swContent, swSandbox);

  ok('sw.js зарегистрировал install, activate, fetch', !!listeners.install && !!listeners.activate && !!listeners.fetch);

  // --- тест install ---
  let installWait;
  await listeners.install({ waitUntil: (p) => { installWait = p; } });
  await installWait;
  ok('install: skipWaiting вызван', skipWaitingCalled);
  ok('install: parket-cache-v2 создан и содержит /js/core.js', cacheStorage.has('parket-cache-v2') && cacheStorage.get('parket-cache-v2').has('/js/core.js'));

  // --- тест activate: удаление устаревших кэшей и сохранение актуальных ---
  cacheStorage.set('parket-cache-v1', new Map([['/old.js', 1]]));
  cacheStorage.set('parket-cache-v0', new Map([['/old.js', 1]]));
  cacheStorage.set('parket-api-v1', new Map([['/api/schedule', 1]]));
  let activateWait;
  await listeners.activate({ waitUntil: (p) => { activateWait = p; } });
  await activateWait;
  ok('activate: clients.claim вызван', clientsClaimCalled);
  ok('activate: устаревший parket-cache-v1 удалён', !cacheStorage.has('parket-cache-v1'));
  ok('activate: устаревший parket-cache-v0 удалён', !cacheStorage.has('parket-cache-v0'));
  ok('activate: актуальный parket-cache-v2 сохранён', cacheStorage.has('parket-cache-v2'));
  ok('activate: parket-api-v1 сохранён', cacheStorage.has('parket-api-v1'));

  // --- тест fetch: скрипты используют Network First (защита от версионного перекоса) ---
  let fetchDispatched;
  const dispatchFetch = async (reqObj) => {
    let handled = false;
    let resultPromise;
    await listeners.fetch({
      request: reqObj,
      respondWith: (p) => { handled = true; resultPromise = p; },
    });
    return handled ? await resultPromise : null;
  };

  // 1. Онлайн: для скрипта /js/core.js запрос идёт в сеть и обновляет кэш
  let netCalls = [];
  networkFetchImpl = async (req) => {
    const u = typeof req === 'string' ? req : req.url;
    netCalls.push(u);
    return { ok: true, status: 200, url: u, source: 'network', clone() { return this; } };
  };
  const scriptOnlineRes = await dispatchFetch({ method: 'GET', url: 'https://parket-2.vercel.app/js/core.js', mode: 'cors' });
  ok('скрипт при наличии сети: взят из сети (Network First)', scriptOnlineRes && scriptOnlineRes.source === 'network' && netCalls.includes('https://parket-2.vercel.app/js/core.js'));

  // 2. Оффлайн (метро): сеть падает, скрипт отдаётся из кэша
  networkFetchImpl = async () => { throw new TypeError('Failed to fetch'); };
  const scriptOfflineRes = await dispatchFetch({ method: 'GET', url: 'https://parket-2.vercel.app/js/core.js', mode: 'cors' });
  ok('скрипт оффлайн: успешно отдаётся из кэша (Cache Fallback)', scriptOfflineRes && scriptOfflineRes.ok && (scriptOfflineRes.url.includes('/js/core.js')));

  // 3. Оффлайн: навигация страницы отдаёт /index.html
  const navOfflineRes = await dispatchFetch({ method: 'GET', url: 'https://parket-2.vercel.app/today', mode: 'navigate' });
  ok('навигация оффлайн: возвращает закэшированный /index.html', navOfflineRes && navOfflineRes.url === '/index.html');

  // 4. API /api/schedule: Network First с сохранением в parket-api-v1
  let apiNetCalled = false;
  networkFetchImpl = async () => {
    apiNetCalled = true;
    return { ok: true, status: 200, clone() { return { ok: true, status: 200, apiCloned: true }; } };
  };
  await dispatchFetch({ method: 'GET', url: 'https://parket-2.vercel.app/api/schedule?profile=me', mode: 'cors' });
  ok('API schedule онлайн: обновляет parket-api-v1', apiNetCalled && cacheStorage.get('parket-api-v1').has('https://parket-2.vercel.app/api/schedule?profile=me'));

  // 5. POST запросы не перехватываются
  const postRes = await dispatchFetch({ method: 'POST', url: 'https://parket-2.vercel.app/api/state', mode: 'cors' });
  ok('POST запросы не перехватываются service worker', postRes === null);

  process.exit(0);
})();
