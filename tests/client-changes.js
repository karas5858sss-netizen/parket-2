const { JSDOM } = require('jsdom');
const fs = require('fs');
const html = require('./load.js');
const mk = (id, date, s, e, subject, kind) => ({ id, date, start: s, end: e, startAt: date+'T'+s+':00', endAt: date+'T'+e+':00', num: 1, kind, subject, title: subject, teacher: 'Т.Т.', room: '8-431', color: '#008000', subgroup: 0, weekType: 1, replaced: false });
const sched = {
  her: { group: 'ДСО12', fetchedAt: '2026-09-19T03:55:00.000Z', errors: [], lessons: [ mk(1,'2026-09-19','08:30','10:05','Инклюзия','пр'), mk(2,'2026-09-19','10:15','11:50','Основы российской государственности','пр'), mk(3,'2026-09-19','12:00','13:35','Основы российской государственности','лек') ] },
  me: { group: 'Мо-24', fetchedAt: '2026-09-19T03:55:00.000Z', errors: [], lessons: [ mk(10,'2026-09-19','09:40','11:10','Конструкция','лек') ] },
};
const W = (d, s, e) => ({ d, s, e, n: 'X', k: 'пр', t: '', r: '', v: '' });
const items = {
  her: [
    { id: 'p1', t: '2026-09-19T05:00:00.000Z', type: 'published', lid: null, date: null, text: 'Опубликованы новые пары до 10 октября (+9)', fields: [] },
    { id: 'r1', t: '2026-09-19T04:00:00.000Z', type: 'removed', lid: '99', date: '2026-09-21', text: 'Отменена: Деловая коммуникация (пр), пн 21 сентября, 12:00–13:35', fields: [] },
    { id: 'c1', t: '2026-09-19T03:20:00.000Z', type: 'changed', lid: '3', date: '2026-09-19', text: 'Изменено: Основы российской государственности (лек), сб 19 сентября 12:00: аудитория 1-292 → 1-300', fields: ['room'] },
    { id: 'm1', t: '2026-09-19T03:00:00.000Z', type: 'moved', lid: '2', date: '2026-09-19', was: W('2026-09-19', '09:00', '10:35'), now: W('2026-09-19', '10:15', '11:50'), text: 'Перенесена: Основы российской государственности (пр), сб 19 сентября, 09:00–10:35 → 10:15–11:50', fields: [] },
    { id: 'old', t: '2026-09-10T03:00:00.000Z', type: 'added', lid: '77', date: '2026-09-10', text: 'Добавлена: Давняя история', fields: [] },
  ],
  me: [
    { id: 'k1', t: '2026-09-19T02:00:00.000Z', type: 'moved', lid: '10', date: '2026-09-19', was: W('2026-09-19', '08:00', '09:30'), now: W('2026-09-19', '09:40', '11:10'), text: 'Перенесена: Конструкция (лек), сб 19 сентября, 08:00–09:30 → 09:40–11:10', fields: [] },
    { id: 'k2', t: '2026-09-19T02:30:00.000Z', type: 'added', lid: '11', date: '2026-09-22', text: 'Добавлена: Автоматика (лек), вт 22 сентября, 09:40–11:10', fields: [] },
  ],
};
const wait = (ms = 60) => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, info) => console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (cond ? '' : '   ' + JSON.stringify(info)));
async function boot({ who = 'her', tg = true, seen, changesStatus = 200 } = {}) {
  const posts = []; let changesCalls = 0;
  const sp = seen ? { seen: { me: seen, her: seen } } : {};
  const docs = { me: { hw: {}, done: {}, colors: {}, custom: {}, prefs: who === 'me' ? sp : {} }, her: { hw: {}, done: {}, colors: {}, custom: {}, prefs: who === 'her' ? sp : {} } };
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://parket-2.vercel.app/', pretendToBeVisual: true,
    beforeParse(w) {
      w.__NOW = '2026-09-19T07:00:00';
      if (tg) w.Telegram = { WebApp: { initData: 'fake', ready(){}, expand(){}, colorScheme: 'light', setHeaderColor(){}, setBackgroundColor(){}, showConfirm(m, cb){ cb(true); } } };
      w.fetch = async (url, opts = {}) => {
        const j = (status, b) => ({ ok: status < 400, status, json: async () => b });
        if (url.startsWith('/api/schedule')) return j(200, sched[url.split('=')[1]]);
        if (url === '/api/changes') { changesCalls++; return changesStatus === 200 ? j(200, { items, checkedAt: 'x' }) : j(changesStatus, {}); }
        if (url === '/api/state' && opts.method === 'POST') { posts.push(JSON.parse(opts.body)); return j(200, { ok: true }); }
        if (url === '/api/state') return j(200, { who, docs });
      };
    } });
  const errs = []; dom.window.addEventListener('error', e => errs.push(e.message));
  await wait(200);
  const d = dom.window.document;
  return { dom, d, posts, errs, calls: () => changesCalls, txt: () => d.getElementById('app').textContent.replace(/\s+/g, ' ').trim(), ls: (k) => dom.window.localStorage.getItem(k),
    card: (text) => [...d.querySelectorAll('.lesson')].find(a => a.textContent.includes(text)),
    click: async (sel) => { const el = d.querySelector(sel); if (!el) { console.log('  (нет ' + sel + ')'); return; } el.click(); await wait(); }, close() { dom.window.close(); } };
}
(async () => {
  let t = await boot();
  ok('блок «Что изменилось: новых 4» (давнишнее и прошедшее не считаются)', t.txt().includes('Что изменилось: новых 4') && !t.txt().includes('Давняя история'), t.txt().slice(0, 300));
  ok('все четыре записи выведены текстом', ['Опубликованы новые пары до 10 октября', 'Отменена: Деловая коммуникация', 'аудитория 1-292 → 1-300', 'Перенесена: Основы российской'].every(x => t.txt().includes(x)));
  ok('блок стоит выше карточки партнёра', t.d.querySelector('#app .chg').compareDocumentPosition(t.d.querySelector('#app .partner')) & 4);
  const c2 = [...t.d.querySelectorAll('.lesson')].find(a => a.textContent.includes('Основы российской') && a.textContent.includes('10:15'));
  const c3 = [...t.d.querySelectorAll('.lesson')].find(a => a.textContent.includes('Основы российской') && a.textContent.includes('12:00'));
  ok('перенесённая пара: пометка «перенесена» и «Было: Сб, 19 сентября, 09:00»', c2 && c2.textContent.includes('перенесена') && c2.textContent.includes('Было: Сб, 19 сентября, 09:00'), c2 && c2.textContent);
  ok('изменённая пара: пометка «изменено»', c3 && c3.textContent.includes('изменено'));
  ok('пара без изменений: пометки нет', !t.card('Инклюзия').textContent.includes('изменено') && !t.card('Инклюзия').textContent.includes('перенесена'));
  ok('подсказка про партнёра: «В расписании Кирилла есть изменения: 2»', t.txt().includes('В расписании Кирилла есть изменения: 2'));
  ok('журнал сохранён в телефоне', JSON.parse(t.ls('parket.changes')).her.length === 5);
  await t.click('[data-tab="cal"]');
  ok('в «Календаре» пометки тоже видны', [...t.d.querySelectorAll('.lesson')].some(a => a.textContent.includes('перенесена')));
  await t.click('[data-tab="today"]');
  await t.click('[data-act="chg-read"]');
  const post = t.posts[t.posts.length - 1];
  ok('«Прочитано»: на сервер ушла метка = время последней записи (05:00)', post && post.prefs && post.prefs.seen && post.prefs.seen.her === '2026-09-19T05:00:00.000Z', post);
  ok('блок свернулся в «Прошлые изменения: 4», пометки на карточках исчезли', t.txt().includes('Прошлые изменения: 4') && !t.txt().includes('новых 4') && !t.d.querySelector('.badge.k-chg'));
  await t.click('[data-act="profile"][data-p="me"]');
  ok('чужой профиль: «Что изменилось у Кирилла: новых 2»', t.txt().includes('Что изменилось у Кирилла: новых 2'));
  ok('пометка на его карточке (перенесена, было 08:00)', t.card('Конструкция').textContent.includes('перенесена') && t.card('Конструкция').textContent.includes('08:00'));
  await t.click('[data-act="chg-read"]');
  const post2 = t.posts[t.posts.length - 1];
  const mine = JSON.parse(t.ls('parket.state')).docs.her.prefs.seen;
  ok('прочитанное партнёра уходит отдельной меткой (seen.me), а у себя в телефоне обе метки на месте', post2.prefs.seen.me === '2026-09-19T02:30:00.000Z' && mine.me === '2026-09-19T02:30:00.000Z' && mine.her === '2026-09-19T05:00:00.000Z', { post2, mine });
  ok('после этого подсказки про партнёра нет', (await (async () => { await t.click('[data-act="profile"][data-p="her"]'); return !t.txt().includes('есть изменения'); })()));
  if (t.errs.length) console.log('JS ERRORS', t.errs); t.close();

  t = await boot({ seen: '2026-09-19T03:30:00.000Z' });
  ok('метка с сервера: непрочитанными остались только записи новее неё (2 из 4)', t.txt().includes('Что изменилось: новых 2') && t.txt().includes('Отменена: Деловая'), t.txt().slice(0, 200));
  ok('у прочитанной перенесённой пары пометки нет, у более новой изменённой — тоже нет (она старше метки)', !t.d.querySelector('.badge.k-chg'));
  t.close();
  t = await boot({ seen: '2026-09-19T06:00:00.000Z' });
  ok('всё прочитано на сервере: только свёрнутый список', !t.d.querySelector('.chg') && t.txt().includes('Прошлые изменения: 4'));
  t.close();
  t = await boot({ tg: false });
  ok('вне Telegram: блока нет, журнал не запрашивается', !t.d.querySelector('.chg') && t.calls() === 0);
  t.close();
  t = await boot({ changesStatus: 500 });
  ok('сервер журнала недоступен: экран работает без блока и без ошибок', !t.d.querySelector('.chg') && t.txt().includes('Инклюзия') && !t.errs.length);
  t.close();
  process.exit(0);
})();
