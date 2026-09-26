// Собирает страницу так, как её видит браузер: подставляет содержимое css/js файлов вместо ссылок на них.
const fs = require('fs');
const path = require('path');
const ROOT = process.env.PARKET_ROOT || path.join(__dirname, '..');
let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
html = html.replace(/<script src="https:\/\/telegram[^>]*><\/script>/, '');
html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (m, href) => '<style>' + fs.readFileSync(path.join(ROOT, href), 'utf8') + '</style>');
html = html.replace(/<script src="([^"]+)"><\/script>/g, (m, src) => '<script>' + fs.readFileSync(path.join(ROOT, src), 'utf8') + '</script>');
module.exports = html;
