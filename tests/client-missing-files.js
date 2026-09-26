const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const build = (skip) => {
  let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(/<script src="https:\/\/telegram[^>]*><\/script>/, '');
  html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, '');
  html = html.replace(/<script src="([^"]+)"><\/script>/g, (m, src) => skip.includes(src) ? '' : '<script>' + fs.readFileSync(path.join(ROOT, src), 'utf8') + '</script>');
  return html;
};
const ok = (n, c, i) => console.log((c ? 'PASS' : 'FAIL') + '  ' + n + (c ? '' : '  ' + i));
const wait = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  for (const [skip, label] of [[[], 'все файлы на месте'], [['js/state.js'], 'нет js/state.js'], [['js/views.js', 'js/sheets.js'], 'нет views.js и sheets.js'], [['js/core.js'], 'нет js/core.js'], [['config/profiles.js'], 'нет config/profiles.js (все остальные файлы от него зависят)']]) {
    const errs = [];
    const dom = new JSDOM(build(skip), { runScripts: 'dangerously', url: 'https://parket-2.vercel.app/', pretendToBeVisual: true,
      beforeParse(w) { w.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) }); } });
    dom.window.addEventListener('error', e => errs.push(e.message));
    await wait(120);
    const txt = dom.window.document.getElementById('app').textContent;
    if (!skip.length) ok(label + ': сообщения об ошибке нет, приложение нарисовано', !txt.includes('не полностью') && txt.includes('Сегодня'), txt.slice(0, 80));
    else ok(label + ': показано понятное сообщение с именами файлов', txt.includes('загрузилось не полностью') && skip.every(s => txt.includes(s)), txt.slice(0, 160));
    dom.window.close();
  }
  process.exit(0);
})();
