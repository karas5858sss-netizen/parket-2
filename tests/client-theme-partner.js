const { JSDOM } = require('jsdom');
const fs = require('fs');
const html = require('./load.js');
let idc = 1;
const mk = (date, s, e, subject, kind, room = '8-431') => ({ id: idc++, date, start: s, end: e, startAt: date+'T'+s+':00', endAt: date+'T'+e+':00', num: 1, kind, subject, title: subject, teacher: 'Т.Т.', room, color: '#008000', subgroup: 0, weekType: 1, replaced: false });
const sched = {
  her: { group: 'ДСО12', fetchedAt: '2026-09-19T03:55:00.000Z', errors: [], lessons: [
    mk('2026-09-19','08:30','10:05','Инклюзия - зона доступа','пр'), mk('2026-09-19','10:15','11:50','Основы российской государственности','пр','6-402 - Аудитория'), mk('2026-09-19','12:00','13:35','Основы российской государственности','лек') ] },
  me: { group: 'Мо-24', fetchedAt: '2026-09-19T03:55:00.000Z', errors: [], lessons: [
    mk('2026-09-19','09:40','11:10','Конструкция и прочность','лек','2206 - Аудитория для практических занятий'), mk('2026-09-22','08:00','22:00','Практика весь день','пр') ] },
};
const wait = (ms = 60) => new Promise(r => setTimeout(r, ms));
const ok = (name, cond) => console.log((cond ? 'PASS' : 'FAIL') + '  ' + name);
async function boot({ who = 'her', now = '2026-09-19T07:00:00', tg = true, colorScheme = 'light', theme = null, docs } = {}) {
  const header = [];
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://parket-2.vercel.app/', pretendToBeVisual: true,
    beforeParse(w) {
      w.__NOW = now;
      if (theme) w.localStorage.setItem('parket.theme', theme);
      if (tg) w.Telegram = { WebApp: { initData: 'fake', ready(){}, expand(){}, colorScheme, setHeaderColor(c){ header.push(c); }, setBackgroundColor(){}, showConfirm(m, cb){ cb(true); } } };
      w.fetch = async (url, opts = {}) => {
        const j = (b) => ({ ok: true, status: 200, json: async () => b });
        if (url.startsWith('/api/schedule')) return j(sched[url.split('=')[1]]);
        if (url === '/api/state' && opts.method === 'POST') return j({ ok: true });
        if (url === '/api/state') return j({ who, docs: docs || { me: { hw: {}, done: {}, colors: {}, custom: {} }, her: { hw: {}, done: {}, colors: {}, custom: {} } } });
      };
    } });
  const errs = []; dom.window.addEventListener('error', e => errs.push(e.message));
  await wait(160);
  const d = dom.window.document;
  return { dom, d, errs, header, root: d.documentElement, txt: () => d.getElementById('app').textContent.replace(/\s+/g, ' ').trim(),
    click: async (sel) => { const el = d.querySelector(sel); if (!el) { console.log('  (нет ' + sel + ')'); return; } el.click(); await wait(); }, close() { dom.window.close(); } };
}
(async () => {
  // ---------- тема ----------
  let t = await boot();
  ok('по умолчанию «как в Telegram»: светлая схема, явной темы нет', t.root.dataset.scheme === 'light' && !t.root.dataset.theme);
  ok('кнопка «Тема» в шапке', !!t.d.querySelector('.themebtn'));
  await t.click('.themebtn');
  ok('лист «Оформление»: 3 варианта, выбран «Как в Telegram»', t.d.querySelectorAll('#themechips .chip').length === 3 && t.d.querySelector('#themechips [data-v="auto"]').getAttribute('aria-pressed') === 'true');
  await t.click('[data-act="theme-set"][data-v="dark"]');
  ok('тёмная: data-theme и data-scheme = dark, выбор запомнен', t.root.dataset.theme === 'dark' && t.root.dataset.scheme === 'dark' && t.dom.window.localStorage.getItem('parket.theme') === 'dark');
  ok('чип «Тёмная» отмечен, окно Telegram перекрашено (#17181c)', t.d.querySelector('#themechips [data-v="dark"]').getAttribute('aria-pressed') === 'true' && t.header.includes('#17181c'));
  await t.click('[data-act="theme-set"][data-v="light"]');
  ok('светлая принудительно', t.root.dataset.theme === 'light' && t.root.dataset.scheme === 'light' && t.header.includes('#ffffff'));
  await t.click('[data-act="theme-set"][data-v="auto"]');
  ok('«как в Telegram»: явная тема снята, окно Telegram вернулось к bg_color', !t.root.dataset.theme && t.header[t.header.length - 1] === 'bg_color');
  t.close();
  t = await boot({ theme: 'dark' });
  ok('после перезапуска тёмная тема на месте', t.root.dataset.theme === 'dark' && t.root.dataset.scheme === 'dark');
  t.close();
  t = await boot({ colorScheme: 'dark' });
  ok('авто + тёмная тема Telegram → scheme dark', t.root.dataset.scheme === 'dark' && !t.root.dataset.theme);
  t.close();
  const src = html;
  ok('в CSS есть явная тёмная палитра и color-scheme', src.includes(':root[data-theme="dark"]') && src.includes('color-scheme: dark'));

  // ---------- партнёр ----------
  t = await boot({ who: 'her' });
  ok('у Маши видно Кирилла: «свободен до 09:40», дальше пара с аудиторией', t.txt().includes('Кирилл свободен до 09:40') && t.txt().includes('Дальше: Конструкция и прочность, ауд. 2206'));
  ok('на «Сегодня» общие окна только от часа: 13:35–22:00 (окно 08:00–08:30 скрыто)', t.txt().includes('Вместе свободны: 13:35–22:00') && !t.txt().includes('08:00–08:30'));
  t.close();
  t = await boot({ who: 'me' });
  ok('у Кирилла видно Машу («свободна до 08:30»)', t.txt().includes('Маша свободна до 08:30') && t.txt().includes('Дальше: Инклюзия'));
  t.close();
  t = await boot({ who: 'me', now: '2026-09-19T10:20:00' });
  ok('Маша на паре: «на паре до 11:50» и предмет с аудиторией 6-402', t.txt().includes('Маша на паре до 11:50') && t.txt().includes('Основы российской государственности, ауд. 6-402'));
  t.close();
  t = await boot({ who: 'me', now: '2026-09-19T20:00:00' });
  ok('вечером: «пары закончились в 13:35»', t.txt().includes('Маша свободна, пары закончились в 13:35'));
  ok('вечером общие окна: остаток 20:00–22:00', t.txt().includes('Вместе свободны: 20:00–22:00'));
  t.close();
  t = await boot({ who: 'me', now: '2026-09-20T09:00:00' });
  ok('воскресенье без пар: «сегодня пар нет»', t.txt().includes('Маша: сегодня пар нет'));
  await t.click('[data-act="profile"][data-p="her"]');
  ok('в профиле партнёра карточка не дублируется', !t.d.querySelector('.partner'));
  t.close();

  // ---------- общие окна на других вкладках ----------
  t = await boot({ who: 'her' });
  await t.click('[data-tab="cal"]');
  const j1 = t.d.querySelector('.joint');
  ok('«Неделя», 19.09: одно окно 13:35–22:00 (8 ч 25 мин), получасового нет, подпись «от 1 ч»', j1 && !j1.textContent.includes('08:00–08:30') && j1.textContent.includes('13:35–22:00') && j1.textContent.includes('8 ч 25 мин') && j1.textContent.includes('от 1 ч'));
  await t.click('[data-act="day"][data-date="2026-09-20"]');
  ok('день без пар у обоих: целое окно 08:00–22:00 (14 ч)', t.d.querySelector('.joint').textContent.includes('08:00–22:00') && t.d.querySelector('.joint').textContent.includes('14 ч'));
  await t.click('[data-act="next"]');
  await t.click('[data-act="day"][data-date="2026-09-22"]');
  ok('Кирилл занят весь день: «Общих окон нет»', t.d.querySelector('.joint').textContent.includes('Общих окон нет'));
  await t.click('[data-tab=\"cal\"]'); await t.click('[data-tab=\"month\"]');
  await t.click('[data-date="2026-09-19"]');
  ok('«Месяц»: блок общих окон тоже есть', !!t.d.querySelector('.joint'));
  t.close();
  t = await boot({ tg: false });
  await t.click('[data-tab="cal"]');
  ok('вне Telegram: карточки партнёра нет, общие окна показываются', !t.d.querySelector('.partner') && !!t.d.querySelector('.joint'));
  t.close();
  process.exit(0);
})();
