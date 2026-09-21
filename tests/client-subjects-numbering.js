const { JSDOM } = require('jsdom');
const fs = require('fs');
const html = require('./load.js');
let idc = 1;
const mk = (date, s, e, subject, kind, extra = {}) => Object.assign({ id: idc++, date, start: s, end: e, startAt: date+'T'+s+':00', endAt: date+'T'+e+':00', num: 0, kind, subject, title: subject, teacher: 'Т.Т.', room: '8-431', color: '#008000', subgroup: 0, weekType: 1, replaced: false }, extra);
const herLessons = () => [
  mk('2026-09-14','08:30','10:05','Старый предмет','пр'),
  mk('2026-09-19','08:30','10:05','Инклюзия','пр'), mk('2026-09-26','08:30','10:05','Инклюзия','пр'), mk('2026-10-03','08:30','10:05','Инклюзия','пр'),
  mk('2026-09-20','10:00','11:00','Завтрашняя','пр', { room: '' }),
  mk('2026-09-21','10:15','11:50','Основы российской государственности','пр'), mk('2026-09-28','10:15','11:50','Основы российской государственности','пр'),
  mk('2026-09-22','09:00','10:00','Зачёт вне сетки','пр', { num: 3 }),
  mk('2026-09-25','12:00','13:35','Общая психология','лек'),
  mk('2026-10-10','14:15','15:50','Далёкий один','пр'), mk('2026-10-11','14:15','15:50','Далёкий два','пр'),
];
const meLessons = () => [ mk('2026-09-19','09:40','11:10','Конструкция','лек'), mk('2026-09-19','13:30','15:00','Практика','пр'), mk('2026-09-19','15:40','17:10','Лаба','лаб'), mk('2026-09-19','17:20','18:50','Вечерняя','пр'), mk('2026-09-19','19:00','20:00','Не по сетке','пр') ];
const wait = (ms = 60) => new Promise(r => setTimeout(r, ms));
const ok = (name, cond, info) => console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (cond ? '' : '   ' + JSON.stringify(info)));
async function boot({ who = 'her', now = '2026-09-19T07:00:00', her, me, done = false, store = {}, noCustom = false } = {}) {
  const sched = { her: { group: 'ДСО12', fetchedAt: '2026-09-19T03:55:00.000Z', errors: [], lessons: her || herLessons() }, me: { group: 'Мо-24', fetchedAt: '2026-09-19T03:55:00.000Z', errors: [], lessons: me || meLessons() } };
  const docs = { me: { hw: {}, done: {}, colors: {}, custom: {}, prefs: {} }, her: {
    hw: { 'основы российской государственности': { name: 'Основы российской государственности', text: 'Конспект', done: false, t: 1 } },
    done: done ? { '2026-09-19|08:30|инклюзия': 1 } : {}, colors: { 'общая психология': 5 },
    custom: noCustom ? {} : { e1: { title: 'Английский', kind: 'пр', date: '2026-09-22', start: '18:00', end: '19:30', room: '204', teacher: '', until: '2026-10-06' } }, prefs: {} } };
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://parket-2.vercel.app/', pretendToBeVisual: true,
    beforeParse(w) {
      w.__NOW = now;
      for (const [k, v] of Object.entries(store)) w.localStorage.setItem(k, v);
      w.Telegram = { WebApp: { initData: 'fake', ready(){}, expand(){}, colorScheme: 'light', setHeaderColor(){}, setBackgroundColor(){}, showConfirm(m, cb){ cb(true); } } };
      w.fetch = async (url, opts = {}) => {
        const j = (status, b) => ({ ok: status < 400, status, json: async () => b });
        if (url.startsWith('/api/schedule')) return j(200, sched[url.split('=')[1]]);
        if (url === '/api/changes') return j(200, { items: { me: [], her: [] } });
        if (url === '/api/state' && opts.method === 'POST') return j(200, { ok: true });
        if (url === '/api/state') return j(200, { who, docs });
      };
    } });
  const errs = []; dom.window.addEventListener('error', e => errs.push(e.message));
  await wait(200);
  const d = dom.window.document;
  const rows = () => [...d.querySelectorAll('.subjrow')].map(r => r.textContent.replace(/\s+/g, ' ').trim());
  return { dom, d, errs, rows, txt: () => d.getElementById('app').textContent.replace(/\s+/g, ' ').trim(), ls: (k) => dom.window.localStorage.getItem(k),
    on: (sel) => d.querySelector(sel).getAttribute('aria-pressed') === 'true',
    click: async (sel) => { const el = d.querySelector(sel); if (!el) { console.log('  (нет ' + sel + ')'); return; } el.click(); await wait(); },
    set: (id, v) => { const el = d.getElementById(id); el.value = v; el.dispatchEvent(new dom.window.Event('input', { bubbles: true })); }, close() { dom.window.close(); } };
}
const goSubjects = async (t) => { await t.click('.tabs [data-tab="cal"]'); await t.click('.seg [data-tab="subjects"]'); };
(async () => {
  let t = await boot();
  await goSubjects(t);
  const R = t.rows();
  ok('переключатель: Неделя | Месяц | Предметы, «Предметы» выбран, внизу «Календарь»', t.d.querySelectorAll('.seg button').length === 3 && t.on('.seg [data-tab="subjects"]') && t.on('.tabs [data-tab="cal"]'));
  const expectedOrder = ['Инклюзия', 'Завтрашняя', 'Основы российской государственности', 'Зачёт вне сетки', 'Английский', 'Общая психология', 'Далёкий один', 'Далёкий два'];
  ok('порядок по ближайшему занятию', expectedOrder.length === R.length && expectedOrder.every((n, i) => R[i].includes(n)), R.map(x => x.slice(0, 40)));
  ok('заголовок: сколько предметов впереди (8)', t.txt().includes('Ближайшие занятия по предметам: 8'));
  ok('«Сегодня» и номер пары: Инклюзия — «1 пара, 08:30–10:05, ауд. 8-431»', R[0].includes('Сегодня') && R[0].includes('1 пара, 08:30–10:05, ауд. 8-431'), R[0]);
  ok('«Завтра» для занятия на 20 сентября (пара без аудитории)', R[1].includes('Завтра') && R[1].includes('10:00–11:00') && !R[1].includes('ауд.'), R[1]);
  ok('ОРГ: «Пн, 21 сентября», «через 2 дня», 2 пара, «Осталось занятий: 2»', R[2].includes('Пн, 21 сентября') && R[2].includes('через 2 дня') && R[2].includes('2 пара') && R[2].includes('Осталось занятий: 2'), R[2]);
  ok('у ОРГ видно активное ДЗ', R[2].includes('Конспект'));
  ok('пара вне сетки берёт номер из расписания вуза (3 пара)', R[3].includes('3 пара, 09:00–10:00'), R[3]);
  ok('своя пара: бейдж «своя», без номера, «Осталось занятий: 3» (серия 22.09, 29.09, 06.10)', R[4].includes('своя') && !R[4].includes('пара, 18:00') && R[4].includes('18:00–19:30') && R[4].includes('Осталось занятий: 3'), R[4]);
  ok('«Пт, 25 сентября», «через 6 дней», бейдж «лек»', R[5].includes('Пт, 25 сентября') && R[5].includes('через 6 дней') && R[5].includes('лек'), R[5]);
  ok('склонение: 21 день / 22 дня', R[6].includes('через 21 день') && R[7].includes('через 22 дня'), [R[6], R[7]]);
  ok('цветная метка предмета на его строке', t.d.querySelectorAll('.subjrow.colored').length === 1 && t.d.querySelector('.subjrow.colored').textContent.includes('Общая психология') && t.d.querySelector('.subjrow.colored').getAttribute('style').includes('#12a594'));
  ok('«Занятий больше нет: 1» со старым предметом', t.txt().includes('Занятий больше нет: 1') && t.txt().includes('Старый предмет'));
  ok('масштаб «Предметы» запомнен', t.ls('parket.calmode') === 'subjects');
  await t.click('.subjrow');
  ok('тап по строке открывает лист занятия (ДЗ, «1 пара» в заголовке)', !!t.d.querySelector('#sheet textarea') && t.d.getElementById('sheet').textContent.includes('1 пара'));
  t.d.querySelector('[data-act="sheet-close"]').click();
  await t.click('.tabs [data-tab="search"]'); await t.click('.tabs [data-tab="cal"]');
  ok('возврат в «Календарь» открывает «Предметы»', !!t.d.querySelector('.subjrow'));
  if (t.errs.length) console.log('JS ERRORS', t.errs); t.close();

  t = await boot({ done: true });
  await goSubjects(t);
  ok('пара отмечена «пройдена» → предмет сдвигается к следующему занятию (26 сентября, осталось 2)', t.rows().find(x => x.startsWith('Инклюзия') || x.includes('Инклюзия')).includes('Сб, 26 сентября') && t.rows().find(x => x.includes('Инклюзия')).includes('Осталось занятий: 2'));
  t.close();
  t = await boot({ now: '2026-09-19T09:00:00' });
  await goSubjects(t);
  ok('пара идёт прямо сейчас: «Сегодня» и «идёт сейчас»', t.rows()[0].includes('Сегодня') && t.rows()[0].includes('идёт сейчас'), t.rows()[0]);
  t.close();
  t = await boot({ her: [mk('2026-09-14','08:30','10:05','Только прошлое','пр')], noCustom: true });
  await goSubjects(t);
  ok('только прошедшие занятия: «Ближайших занятий нет» и список ниже', t.txt().includes('Ближайших занятий нет') && t.txt().includes('Занятий больше нет'));
  t.close();
  t = await boot({ her: [] });
  await goSubjects(t);
  ok('пустое расписание (остаются свои пары) — предметы всё равно из них', t.rows().length === 1 && t.rows()[0].includes('Английский'));
  t.close();
  t = await boot({ who: 'me' });
  await t.click('[data-act="profile"][data-p="her"]');
  await goSubjects(t);
  ok('чужой профиль: «Предметы» Маши', t.rows().length === 8 && t.rows()[0].includes('Инклюзия'));
  t.close();

  // ---------- нумерация на карточках ----------
  t = await boot({ who: 'me' });
  const cards = () => [...t.d.querySelectorAll('.lesson')].map(a => a.textContent.replace(/\s+/g, ' '));
  const find = (name) => cards().find(c => c.includes(name)) || '';
  ok('у Кирилла по его сетке: 09:40 → «2 пара», 13:30 → «4 пара», 15:40 → «5 пара», 17:20 → «6 пара»', find('Конструкция').includes('2 пара') && find('Практика').includes('4 пара') && find('Лаба').includes('5 пара') && find('Вечерняя').includes('6 пара'), cards());
  ok('время не из сетки (19:00) — без номера', !/пара/.test(find('Не по сетке')), find('Не по сетке'));
  await t.click('[data-act="profile"][data-p="her"]');
  const findH = (name) => [...t.d.querySelectorAll('.lesson')].map(a => a.textContent.replace(/\s+/g, ' ')).find(c => c.includes(name)) || '';
  ok('у Маши по её сетке: 08:30 → «1 пара» (а у Кирилла тоже 1 пара, но в 08:00)', findH('Инклюзия').includes('1 пара'));
  t.close();
  t = await boot({ who: 'her', me: [mk('2026-09-19','08:00','09:30','Первая Кирилла','лек')], her: [mk('2026-09-19','08:30','10:05','Первая Маши','пр'), mk('2026-09-19','16:00','17:35','Пятая Маши','пр'), mk('2026-09-19','08:00','09:30','Восемь ноль-ноль у Маши','пр')] });
  const c2 = [...t.d.querySelectorAll('.lesson')].map(a => a.textContent.replace(/\s+/g, ' '));
  ok('у Маши 16:00 → «5 пара»; 08:00 в её сетке нет — без номера (сетки не перепутаны)', c2.find(c => c.includes('Пятая')).includes('5 пара') && !/пара/.test(c2.find(c => c.includes('Восемь'))), c2);
  // ---------- форма: кнопки номеров ----------
  await t.click('.fab');
  ok('форма у Маши: 5 кнопок номеров (её сетка)', t.d.querySelectorAll('#f-slots .chip').length === 5);
  await t.click('#f-slots [data-v="4"]');
  ok('кнопка «5» подставляет 16:00–17:35 и подсвечивается', t.d.getElementById('f-start').value === '16:00' && t.d.getElementById('f-end').value === '17:35' && t.on('#f-slots [data-v="4"]'));
  t.set('f-start', '10:15'); t.set('f-end', '11:50');
  ok('время вручную совпало с сеткой → подсвечена «2»', t.on('#f-slots [data-v="1"]') && !t.on('#f-slots [data-v="4"]'));
  t.set('f-end', '11:40');
  ok('время не совпало — подсветка снята', ![...t.d.querySelectorAll('#f-slots .chip')].some(c => c.getAttribute('aria-pressed') === 'true'));
  t.set('f-title', 'Тест'); t.set('f-start', '12:00'); t.set('f-end', '13:35');
  await t.click('[data-act="f-save"]');
  const tc = [...t.d.querySelectorAll('.lesson')].map(a => a.textContent.replace(/\s+/g, ' ')).find(c => c.includes('Тест'));
  ok('своя пара на 12:00 сразу получила номер «3 пара»', tc && tc.includes('3 пара') && tc.includes('своя'), tc);
  t.close();
  t = await boot({ who: 'me' });
  await t.click('.fab');
  ok('форма у Кирилла: 6 кнопок, «3» = 11:50–13:20', t.d.querySelectorAll('#f-slots .chip').length === 6 && (await (async () => { await t.click('#f-slots [data-v="2"]'); return t.d.getElementById('f-start').value === '11:50' && t.d.getElementById('f-end').value === '13:20'; })()));
  t.close();
  process.exit(0);
})();
