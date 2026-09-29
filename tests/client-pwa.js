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

// 4. Проверка sw.js
const swPath = path.join(ROOT, 'sw.js');
ok('файл sw.js существует', fs.existsSync(swPath));
const swContent = fs.readFileSync(swPath, 'utf8');
ok('sw.js: содержит обработчики install, activate и fetch', swContent.includes('install') && swContent.includes('activate') && swContent.includes('fetch'));
ok('sw.js: кеширует статические файлы и манифест', swContent.includes('/index.html') && swContent.includes('/manifest.json'));

process.exit(0);
