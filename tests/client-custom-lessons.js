const { JSDOM } = require('jsdom');
const fs = require('fs');
const html = require('./load.js');
let idc = 1;
const mk = (date, s, e, subject, kind) => ({ id: idc++, date, start: s, end: e, startAt: date+'T'+s+':00', endAt: date+'T'+e+':00', num: 1, kind, subject, title: subject, teacher: 'Т.Т.', room: '8-431', color: '#008000', subgroup: 0, weekType: 1, replaced: false });
const sched = { her: { group: 'ДСО12', fetchedAt: '2026-09-19T03:55:00.000Z', errors: [], lessons: [ mk('2026-09-19','08:30','10:05','Инклюзия - зона доступа','пр') ] },
                me: { group: 'Мо-24', fetchedAt: '2026-09-19T03:55:00.000Z', errors: [], lessons: [ mk('2026-09-19','09:40','11:10','Конструкция и прочность','лек') ] } };
const wait = (ms = 60) => new Promise(r => setTimeout(r, ms));
const ok = (name, cond) => console.log((cond ? 'PASS' : 'FAIL') + '  ' + name);
(async () => {
  const posts = [], confirms = [];
  const docs = { her: { hw: {}, done: {}, colors: {}, custom: {} },
                 me: { hw: {}, done: {}, colors: {}, custom: { k1: { title: 'Консультация', kind: '', date: '2026-09-19', start: '10:00', end: '10:45', room: '3-12', teacher: '' } } } };
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://parket-2.vercel.app/', pretendToBeVisual: true,
    beforeParse(w) {
      w.__NOW = '2026-09-19T07:00:00';
      w.Telegram = { WebApp: { initData: 'fake', ready(){}, expand(){}, colorScheme: 'light', showConfirm(m, cb){ confirms.push(m); cb(true); } } };
      w.fetch = async (url, opts = {}) => {
        const j = (b) => ({ ok: true, status: 200, json: async () => b });
        if (url.startsWith('/api/schedule')) return j(sched[url.split('=')[1]]);
        if (url === '/api/state' && opts.method === 'POST') { posts.push(JSON.parse(opts.body)); return j({ ok: true }); }
        if (url === '/api/state') return j({ who: 'her', docs });
      };
    } });
  const errs = []; dom.window.addEventListener('error', e => errs.push(e.message));
  await wait(150);
  const d = dom.window.document;
  const txt = () => d.getElementById('app').textContent.replace(/\s+/g, ' ').trim();
  const click = async (sel) => { const el = d.querySelector(sel); if (!el) { console.log('  (нет ' + sel + ')'); return; } el.click(); await wait(); };
  const set = (id, v) => { const el = d.getElementById(id); el.value = v; el.dispatchEvent(new dom.window.Event('input', { bubbles: true })); };
  const lastCustom = () => { const p = [...posts].reverse().find(x => x.custom); return p ? Object.values(p.custom)[0] : undefined; };
  const cards = () => [...d.querySelectorAll('.lesson')].filter(a => a.textContent.includes('Английский'));

  ok('FAB «+» есть в своём профиле', !!d.querySelector('.fab'));
  await click('.fab');
  ok('форма открыта, дата по умолчанию — сегодня', !!d.getElementById('f-title') && d.getElementById('f-date').value === '2026-09-19');
  await click('[data-act="f-save"]');
  ok('пустое название: ошибка, запроса нет', !d.getElementById('f-err').hidden && d.getElementById('f-err').textContent.includes('название') && posts.length === 0);
  set('f-title', 'Английский'); set('f-start', '18:00'); set('f-end', '17:00');
  await click('[data-act="f-save"]');
  ok('конец раньше начала: ошибка', d.getElementById('f-err').textContent.includes('позже начала') && posts.length === 0);
  set('f-end', '19:30');
  await click('[data-act="f-kind"][data-v="пр"]');
  await click('[data-act="f-repeat"][data-v="1"]');
  ok('«Каждую неделю» показывает поле «до» с датой +8 недель', !d.getElementById('f-until-wrap').hidden && d.getElementById('f-until').value === '2026-11-14');
  set('f-until', '2028-01-01');
  await click('[data-act="f-save"]');
  ok('повтор дольше 400 дней: ошибка', d.getElementById('f-err').textContent.includes('400') && posts.length === 0);
  set('f-until', '2026-10-03'); set('f-room', '204');
  await click('[data-act="f-save"]');
  const c1 = lastCustom();
  ok('сохранено: на сервер ушла серия до 03.10', posts.length === 1 && c1 && c1.title === 'Английский' && c1.kind === 'пр' && c1.until === '2026-10-03' && c1.room === '204' && c1.start === '18:00');
  ok('форма закрылась, на «Сегодня» появилась пара с бейджем «своя»', !d.querySelector('#sheet .sheet') && txt().includes('Английский') && txt().includes('своя'));
  await click('[data-tab="search"]');
  ok('поиск «Английский»: 3 занятия серии (19.09, 26.09, 03.10)', (() => { const q = d.getElementById('q'); q.value = 'английский'; q.dispatchEvent(new dom.window.Event('input', { bubbles: true })); return txt().includes('Найдено пар: 3'); })());
  await click('[data-tab="cal"]'); await click('[data-tab="month"]');
  ok('месяц: 26 сентября подсвечено', d.querySelector('[data-date="2026-09-26"]').classList.contains('has'));
  await click('[data-tab="search"]');
  // открыть занятие серии
  cards()[1].click(); await wait();
  ok('лист своей пары: изменить / пропустить дату / удалить серию + ДЗ', !!d.querySelector('[data-act="c-edit"]') && !!d.querySelector('[data-act="c-skip"]') && d.querySelector('[data-act="c-del"]').textContent.includes('серию') && !!d.getElementById('hwtext'));
  await click('[data-act="c-skip"]');
  ok('пропуск даты: 2 занятия, в запросе skip, есть тост', lastCustom().skip && lastCustom().skip.length === 1 && cards().length === 2 && !d.getElementById('toast').hidden);
  await click('[data-act="undo"]');
  ok('UNDO возвращает 3 занятия', cards().length === 3 && !lastCustom().skip);
  // редактирование
  cards()[0].click(); await wait();
  await click('[data-act="c-edit"]');
  ok('форма изменения заполнена (название, «Каждую неделю»)', d.getElementById('f-title').value === 'Английский' && d.querySelector('#f-repeats [data-v="1"]').getAttribute('aria-pressed') === 'true' && d.getElementById('f-until').value === '2026-10-03');
  set('f-room', '305');
  await click('[data-act="f-save"]');
  ok('правка сохранена (аудитория 305, серия та же)', lastCustom().room === '305' && lastCustom().until === '2026-10-03' && cards().length === 3);
  // удаление серии
  cards()[0].click(); await wait();
  await click('[data-act="c-del"]');
  ok('удаление серии: попап, пары исчезли, на сервер null', confirms.some(m => m.includes('всю серию')) && cards().length === 0 && lastCustom() === null);
  await click('[data-act="undo"]');
  ok('UNDO восстанавливает серию', cards().length === 3);
  // чужой профиль
  await click('[data-tab="today"]');
  await click('[data-act="profile"][data-p="me"]');
  ok('чужой профиль: пара владельца видна с бейджем, FAB нет', txt().includes('Консультация') && txt().includes('своя') && !d.querySelector('.fab'));
  const cons = [...d.querySelectorAll('.lesson')].find(a => a.textContent.includes('Консультация')); cons.click(); await wait();
  ok('чужая своя пара: кнопок изменения нет', !d.querySelector('[data-act="c-edit"]') && !d.querySelector('[data-act="c-del"]'));
  if (errs.length) console.log('JS ERRORS', errs);
  dom.window.close(); process.exit(0);
})();
