const { JSDOM } = require('jsdom');
const fs = require('fs');
const html = require('./load.js');
let idc = 1;
const mk = (date, s, e, subject, kind, teacher = 'Т.Т.', extra = {}) => Object.assign({ id: idc++, date, start: s, end: e, startAt: date+'T'+s+':00', endAt: date+'T'+e+':00', num: 1, kind, subject, title: subject, teacher, room: '8-431', color: '#008000', subgroup: 0, weekType: 1, replaced: false }, extra);
const VAR = [{ n: 1, teacher: 'Полковник1', room: '11-201г' }, { n: 2, teacher: 'Полковник2', room: '11-201/1' }];
const her = { group: 'ДСО12', fetchedAt: '2026-09-19T03:55:00.000Z', errors: [], lessons: [
  mk('2026-09-14','14:15','15:50','Общая психология','пр','преп.Щербань А.С.'),
  mk('2026-09-19','08:30','10:05','Инклюзия - зона доступа','пр','ст.пр.Романова Е.А.'),
  mk('2026-09-19','10:15','11:50','Основы российской государственности','пр','преп.Прусов Ф.Е.'),
  mk('2026-09-19','12:00','13:35','Основы российской государственности','лек','доц.Эгильский Е.Э.'),
  mk('2026-09-23','08:30','10:05','ОСНОВЫ ВОЕННОЙ ПОДГОТОВКИ (Нижняя ср)','лек','',{ room: '', variants: VAR }),
  mk('2026-10-07','08:30','10:05','ОСНОВЫ ВОЕННОЙ ПОДГОТОВКИ (Нижняя ср)','лек','',{ room: '', variants: VAR }),
] };
const big = { group: 'X', fetchedAt: her.fetchedAt, errors: [], lessons: Array.from({ length: 60 }, (_, i) => mk('2026-11-' + String(1 + (i % 28)).padStart(2, '0'), String(8 + (i % 8)).padStart(2, '0') + ':00', String(9 + (i % 8)).padStart(2, '0') + ':00', 'Предмет номер ' + i, 'пр')).sort((a, b) => a.startAt < b.startAt ? -1 : 1) };
const wait = (ms = 60) => new Promise(r => setTimeout(r, ms));
async function boot(schedHer, docs) {
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://parket-2.vercel.app/', pretendToBeVisual: true,
    beforeParse(w) {
      w.__NOW = '2026-09-19T07:00:00';
      w.Telegram = { WebApp: { initData: 'fake', ready(){}, expand(){}, colorScheme: 'light', showConfirm(m, cb){ cb(true); } } };
      w.fetch = async (url, opts = {}) => {
        const j = (b) => ({ ok: true, status: 200, json: async () => b });
        if (url.startsWith('/api/schedule')) return j(url.endsWith('her') ? schedHer : her);
        if (url === '/api/state') return (opts.method === 'POST') ? j({ ok: true }) : j({ who: 'her', docs });
      };
    } });
  const errs = []; dom.window.addEventListener('error', e => errs.push(e.message));
  await wait(120);
  const d = dom.window.document;
  return { dom, d, errs, txt: () => d.getElementById('app').textContent.replace(/\s+/g, ' ').trim(), click: async (sel) => { const el = d.querySelector(sel); if (!el) { console.log('  (нет элемента ' + sel + ')'); return; } el.click(); await wait(); }, close() { dom.window.close(); } };
}
const ok = (name, cond) => console.log((cond ? 'PASS' : 'FAIL') + '  ' + name);
const docs = { me: { hw: {}, done: {} }, her: { hw: {
  'основы российской государственности': { name: 'Основы российской государственности', text: 'Конспект', done: false, t: 1 },
  'основы военной подготовки (нижняя ср)': { name: 'ОВП', text: 'Форма', done: true, t: 1 },
}, done: {} } };

(async () => {
  let t = await boot(her, docs);
  ok('4 вкладки в нижней панели', t.d.querySelectorAll('.tabs button').length === 4);
  await t.click('[data-tab=\"cal\"]'); await t.click('[data-tab=\"month\"]');
  ok('месяц: заголовок «сентябрь 2026»', t.txt().includes('сентябрь 2026'));
  ok('30 дней в сетке', t.d.querySelectorAll('.cell:not(.out)').length === 30);
  ok('дни с парами подсвечены (14, 19, 23)', ['2026-09-14','2026-09-19','2026-09-23'].every(x => t.d.querySelector(`[data-date="${x}"]`).classList.contains('has')) && !t.d.querySelector('[data-date="2026-09-20"]').classList.contains('has'));
  ok('красная точка на 19 (ДЗ по госуд.) и нет на 23 (ДЗ выполнено)', !!t.d.querySelector('[data-date="2026-09-19"] .rd') && !t.d.querySelector('[data-date="2026-09-23"] .rd'));
  ok('сегодняшний день выбран, видны его пары', t.d.querySelector('[data-date="2026-09-19"]').getAttribute('aria-pressed') === 'true' && t.txt().includes('Инклюзия'));
  await t.click('[data-date="2026-09-23"]');
  ok('клик по дню фильтрует список (военка, без Инклюзии)', t.txt().includes('ВОЕННОЙ') && !t.txt().includes('Инклюзия'));
  await t.click('[data-act="mnext"]');
  ok('следующий месяц: октябрь, 7 подсвечено, «Выбери день»', t.txt().includes('октябрь 2026') && t.d.querySelector('[data-date="2026-10-07"]').classList.contains('has') && t.txt().includes('Выбери день'));
  await t.click('[data-act="mtoday"]');
  ok('«К текущему месяцу» возвращает сентябрь', t.txt().includes('сентябрь 2026'));
  // поиск
  await t.click('[data-tab="search"]');
  ok('поиск: по умолчанию только предстоящие (без 14.09)', t.txt().includes('Найдено пар: 5') && !t.txt().includes('Щербань'));
  const q0 = t.d.getElementById('q');
  q0.value = 'государств'; q0.dispatchEvent(new t.dom.window.Event('input', { bubbles: true })); await wait();
  ok('поиск «государств»: 2 пары, поле ввода не пересоздано', t.txt().includes('Найдено пар: 2') && t.d.getElementById('q') === q0);
  await t.click('[data-act="kind"][data-v="лек"]');
  ok('фильтр «Лекции»: 1 пара', t.txt().includes('Найдено пар: 1') && t.txt().includes('Эгильский'));
  await t.click('[data-act="kind"][data-v="all"]');
  t.d.getElementById('q').value = 'щербань'; t.d.getElementById('q').dispatchEvent(new t.dom.window.Event('input', { bubbles: true })); await wait();
  ok('прошедшие скрыты: «щербань» ничего не находит', t.txt().includes('Ничего не найдено'));
  await t.click('[data-act="tgl"][data-v="past"]');
  ok('«И прошедшие»: находит 14.09', t.txt().includes('Найдено пар: 1') && t.txt().includes('14 сентября'));
  t.d.getElementById('q').value = 'полковник2'; t.d.getElementById('q').dispatchEvent(new t.dom.window.Event('input', { bubbles: true })); await wait();
  ok('поиск идёт и по преподавателям подгрупп (военка, 2 пары)', t.txt().includes('Найдено пар: 2') && t.txt().includes('ВОЕННОЙ') && !t.txt().includes('Эгильский'));
  t.d.getElementById('q').value = ''; t.d.getElementById('q').dispatchEvent(new t.dom.window.Event('input', { bubbles: true }));
  await t.click('[data-act="tgl"][data-v="past"]');
  await t.click('[data-act="tgl"][data-v="onlyHw"]');
  ok('фильтр «С ДЗ»: только предмет с активным ДЗ', t.txt().includes('Найдено пар: 2') && !t.txt().includes('Инклюзия'));
  await t.click('.lesson[data-act="open"]');
  ok('из результатов поиска открывается лист ДЗ', !!t.d.querySelector('#sheet textarea'));
  t.d.querySelector('[data-act="sheet-close"]').click();
  if (t.errs.length) console.log('JS ERRORS', t.errs); t.close();
  // «Показать ещё»
  t = await boot(big, docs);
  await t.click('[data-tab="search"]');
  ok('60 результатов: показано 50 и кнопка «Показать ещё»', t.txt().includes('Найдено пар: 60') && t.d.querySelectorAll('#results .lesson').length === 50 && !!t.d.querySelector('[data-act="more"]'));
  await t.click('[data-act="more"]');
  ok('«Показать ещё»: показаны все 60', t.d.querySelectorAll('#results .lesson').length === 60 && !t.d.querySelector('[data-act="more"]'));
  if (t.errs.length) console.log('JS ERRORS', t.errs); t.close();
  process.exit(0);
})();
