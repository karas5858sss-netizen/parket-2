// Версия схемы данных в телефоне (js/state.js: STORAGE_VERSION, ключ parket.schema).
// Сейчас это просто отметка на будущее — если структура хранения когда-нибудь изменится
// сильнее, чем «появилось новое поле», здесь будет что почистить. Главное свойство, которое
// тест проверяет: расхождение версии стирает только то, что и так безопасно перекачать заново
// (кеш расписания, журнал изменений), и НИКОГДА не трогает ДЗ/отметки и уж тем более
// несохранённые правки пользователя (parket.pending) — их терять нельзя.
const html = require('./load.js');
const { JSDOM } = require('jsdom');

const wait = (ms = 120) => new Promise((r) => setTimeout(r, ms));
const ok = (name, cond, info) => console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (cond ? '' : '   ' + JSON.stringify(info)));

async function boot(preset = {}) {
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://parket-2.vercel.app/', pretendToBeVisual: true,
    beforeParse(w) {
      w.__NOW = '2026-09-19T07:00:00';
      for (const [k, v] of Object.entries(preset)) w.localStorage.setItem(k, v);
      w.fetch = async (url) => ({ ok: false, status: 500, json: async () => ({}) }); // сеть не важна для этого теста
    } });
  await wait();
  return { dom, ls: (k) => dom.window.localStorage.getItem(k), close() { dom.window.close(); } };
}

(async () => {
  // ---------- 1: первый запуск (пусто) — версия проставляется, ничего не падает ----------
  {
    const t = await boot();
    ok('после первого запуска отметка версии проставлена', t.ls('parket.schema') === '1');
    t.close();
  }

  // ---------- 2: старые данные без отметки версии — кеш и журнал стираются ----------
  {
    const t = await boot({
      'parket.cache.me': JSON.stringify({ lessons: [{ id: 1 }] }),
      'parket.cache.her': JSON.stringify({ lessons: [{ id: 2 }] }),
      'parket.changes': JSON.stringify({ me: [{ id: 'x' }], her: [] }),
    });
    ok('кеш расписания (me) стёрт при несовпадении версии', t.ls('parket.cache.me') === null);
    ok('кеш расписания (her) стёрт при несовпадении версии', t.ls('parket.cache.her') === null);
    ok('журнал изменений стёрт при несовпадении версии', t.ls('parket.changes') === null);
    ok('версия проставлена после очистки', t.ls('parket.schema') === '1');
    t.close();
  }

  // ---------- 3: главное — ДЗ и несохранённые правки НЕ теряются ----------
  {
    const savedState = JSON.stringify({ who: 'her', docs: { me: { hw: {}, done: {}, colors: {}, custom: {}, prefs: {} }, her: { hw: { x: { name: 'X', text: 'важное ДЗ', done: false } }, done: {}, colors: {}, custom: {}, prefs: {} } } });
    const savedPending = JSON.stringify({ hw: { y: { name: 'Y', text: 'несохранённая правка', done: false } }, done: {}, colors: {}, custom: {}, prefs: {} });
    const t = await boot({ 'parket.state': savedState, 'parket.pending': savedPending }); // без parket.schema — «старые» данные
    ok('ДЗ (parket.state) не тронуто при расхождении версии схемы', t.ls('parket.state') === savedState);
    ok('несохранённая правка (parket.pending) не тронута при расхождении версии схемы', t.ls('parket.pending') === savedPending);
    ok('версия всё равно проставлена', t.ls('parket.schema') === '1');
    t.close();
  }

  // ---------- 4: версия уже совпадает — ничего лишний раз не стирается ----------
  {
    const t = await boot({
      'parket.schema': '1',
      'parket.cache.me': JSON.stringify({ lessons: [{ id: 1 }] }),
      'parket.changes': JSON.stringify({ me: [], her: [] }),
    });
    ok('при совпадении версии кеш расписания остаётся на месте', t.ls('parket.cache.me') !== null);
    ok('при совпадении версии журнал изменений остаётся на месте', t.ls('parket.changes') !== null);
    t.close();
  }

  // ---------- 5: явно устаревшая (не просто отсутствующая) версия тоже считается расхождением ----------
  {
    const t = await boot({ 'parket.schema': '0', 'parket.cache.her': JSON.stringify({ lessons: [] }) });
    ok('явно старая версия («0») тоже приводит к очистке кеша', t.ls('parket.cache.her') === null);
    ok('версия обновлена до текущей', t.ls('parket.schema') === '1');
    t.close();
  }
  process.exit(0);
})();
