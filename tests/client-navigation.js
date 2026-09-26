const { JSDOM } = require('jsdom');
const fs = require('fs');
const html = require('./load.js');
const mk = (date, s, e, subject, kind) => ({ id: 1, date, start: s, end: e, startAt: date+'T'+s+':00', endAt: date+'T'+e+':00', num: 1, kind, subject, title: subject, teacher: 'Т.Т.', room: '8-431', color: '#008000', subgroup: 0, weekType: 1, replaced: false });
const wait = (ms = 60) => new Promise(r => setTimeout(r, ms));
const ok = (name, cond) => console.log((cond ? 'PASS' : 'FAIL') + '  ' + name);
async function boot(store = {}) {
  const sched = { group: 'ДСО12', fetchedAt: '2026-09-19T03:55:00.000Z', errors: [], lessons: [mk('2026-09-19','08:30','10:05','Инклюзия','пр')] };
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://parket-2.vercel.app/', pretendToBeVisual: true,
    beforeParse(w) {
      w.__NOW = '2026-09-19T07:00:00';
      for (const [k, v] of Object.entries(store)) w.localStorage.setItem(k, v);
      w.fetch = async (url) => ({ ok: true, status: url === '/api/state' ? 401 : 200, json: async () => (url.startsWith('/api/schedule') ? sched : {}) });
    } });
  await wait(150);
  const d = dom.window.document;
  return { dom, d, ls: (k) => dom.window.localStorage.getItem(k), txt: () => d.getElementById('app').textContent.replace(/\s+/g, ' ').trim(),
    click: async (sel) => { const el = d.querySelector(sel); if (!el) { console.log('  (нет ' + sel + ')'); return; } el.click(); await wait(); }, close() { dom.window.close(); } };
}
const on = (t, sel) => t.d.querySelector(sel).getAttribute('aria-pressed') === 'true';
(async () => {
  let t = await boot();
  const names = [...t.d.querySelectorAll('.tabs button')].map(b => b.textContent);
  ok('нижняя панель: Сегодня, Календарь, Поиск, Итоги', names.join('|') === 'Сегодня|Календарь|Поиск|Итоги');
  ok('старт: активна «Сегодня»', on(t, '.tabs [data-tab="today"]'));
  ok('на «Сегодня» переключателя масштаба нет', !t.d.querySelector('.seg'));
  await t.click('.tabs [data-tab="cal"]');
  ok('«Календарь» открывается «Неделей», внизу подсвечен «Календарь»', on(t, '.tabs [data-tab="cal"]') && !!t.d.querySelector('.wk [data-act="prev"]'));
  ok('вверху переключатель Неделя | Месяц | Предметы, выбрана «Неделя»', t.d.querySelectorAll('.seg button').length === 3 && on(t, '.seg [data-tab="week"]') && !on(t, '.seg [data-tab="month"]'));
  await t.click('.seg [data-tab="month"]');
  ok('«Месяц»: сетка на месте, «Календарь» внизу всё ещё подсвечен', !!t.d.querySelector('.cal') && on(t, '.seg [data-tab="month"]') && on(t, '.tabs [data-tab="cal"]'));
  await t.click('.tabs [data-tab="search"]');
  ok('«Поиск»: календарь внизу не подсвечен', on(t, '.tabs [data-tab="search"]') && !on(t, '.tabs [data-tab="cal"]') && !t.d.querySelector('.seg'));
  await t.click('.tabs [data-tab="cal"]');
  ok('возврат в «Календарь» открывает последний масштаб («Месяц»)', !!t.d.querySelector('.cal') && on(t, '.seg [data-tab="month"]'));
  ok('масштаб запомнен для следующего запуска', t.ls('parket.calmode') === 'month');
  await t.click('.tabs [data-tab="stats"]');
  ok('«Итоги» открываются', on(t, '.tabs [data-tab="stats"]') && t.txt().includes('Прогресс семестра'));
  t.close();
  t = await boot({ 'parket.calmode': 'month', 'parket.tab': 'today' });
  await t.click('.tabs [data-tab="cal"]');
  ok('после перезапуска «Календарь» сразу в «Месяце»', !!t.d.querySelector('.cal'));
  t.close();
  t = await boot({ 'parket.tab': 'week' });
  ok('старое сохранённое значение «week» открывается календарём с выбранной «Неделей»', on(t, '.tabs [data-tab="cal"]') && on(t, '.seg [data-tab="week"]'));
  t.close();
  t = await boot({ 'parket.tab': 'month' });
  ok('старое «month»: календарь, но масштаб берётся из сохранённого вкладкой', on(t, '.tabs [data-tab="cal"]') && !!t.d.querySelector('.seg'));
  t.close();
  const src = html;
  ok('в CSS панель на 4 колонки', src.includes('grid-template-columns: repeat(4, 1fr); padding-bottom'));
  process.exit(0);
})();
