const { JSDOM } = require('jsdom');
const fs = require('fs');
const html = require('./load.js');
let idc = 1;
const mk = (date, s, e, subject, kind) => ({ id: idc++, date, start: s, end: e, startAt: date+'T'+s+':00', endAt: date+'T'+e+':00', num: 1, kind, subject, title: subject, teacher: 'Т.Т.', room: '8-431', color: '#008000', subgroup: 0, weekType: 1, replaced: false });
const sched = {
  her: { group: 'ДСО12', fetchedAt: '2026-09-19T03:55:00.000Z', errors: [], lessons: [
    mk('2026-09-19','08:30','10:05','Инклюзия - зона доступа','пр'),
    mk('2026-09-19','10:15','11:50','Основы российской государственности','пр'),
    mk('2026-09-19','12:00','13:35','Основы российской государственности','лек') ] },
  me: { group: 'Мо-24', fetchedAt: '2026-09-19T03:55:00.000Z', errors: [], lessons: [ mk('2026-09-19','09:40','11:10','Конструкция и прочность','лек') ] },
};
const wait = (ms = 60) => new Promise(r => setTimeout(r, ms));
const ok = (name, cond) => console.log((cond ? 'PASS' : 'FAIL') + '  ' + name);
(async () => {
  const posts = [];
  const docs = { her: { hw: { 'основы российской государственности': { name: 'ОРГ', text: 'Конспект', done: false, t: 1 } }, done: {} },
                 me: { hw: {}, done: {}, colors: { 'конструкция и прочность': 8 } } };   // у her поля colors нет: старый документ
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://parket-2.vercel.app/', pretendToBeVisual: true,
    beforeParse(w) {
      w.__NOW = '2026-09-19T07:00:00';
      w.Telegram = { WebApp: { initData: 'fake', ready(){}, expand(){}, colorScheme: 'light', showConfirm(m, cb){ cb(true); } } };
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
  const click = async (sel) => { const el = d.querySelector(sel); if (!el) { console.log('  (нет ' + sel + ')'); return; } el.click(); await wait(); };
  const orgCards = () => [...d.querySelectorAll('.lesson')].filter(a => a.textContent.includes('государственности'));

  ok('старый документ без colors читается, цветов нет', d.querySelectorAll('.lesson.colored').length === 0);
  await click('.lesson[data-act="open"]');               // самая ранняя: Инклюзия
  ok('в листе 16 цветов + «без цвета»', d.querySelectorAll('#swatches .sw').length === 17);
  d.querySelector('[data-act="sheet-close"]').click();
  // открываем ОРГ (у него есть ДЗ), вводим текст и выбираем цвет
  const org = orgCards()[0]; org.click(); await wait();
  const ta = d.getElementById('hwtext'); ta.value = 'Конспект + вопросы'; 
  await click('#swatches [data-i="5"]');
  ok('цвет отправлен на сервер (индекс 5)', posts.length === 1 && Object.values(posts[0].colors)[0] === 5);
  ok('несохранённый текст в поле не потерян при выборе цвета', d.getElementById('hwtext').value === 'Конспект + вопросы');
  ok('выбранный цвет отмечен (aria-pressed)', d.querySelector('#swatches [data-i="5"]').getAttribute('aria-pressed') === 'true' && d.querySelector('#swatches [data-i="-1"]').getAttribute('aria-pressed') === 'false');
  d.querySelector('[data-act="sheet-close"]').click(); await wait();
  ok('обе пары предмета получили цветную полоску (#12a594)', orgCards().length >= 2 && orgCards().every(a => a.classList.contains('colored') && a.getAttribute('style').includes('#12a594')));
  ok('пара другого предмета без цвета', ![...d.querySelectorAll('.lesson')].find(a => a.textContent.includes('Инклюзия')).classList.contains('colored'));
  ok('элемент «Активное ДЗ» тоже окрашен', !!d.querySelector('.hwitem.colored'));
  // смена цвета и снятие
  orgCards()[0].click(); await wait();
  await click('#swatches [data-i="12"]');
  ok('смена цвета: розовый (#e5508f)', orgCards()[0].getAttribute('style').includes('#e5508f'));
  await click('#swatches [data-i="-1"]');
  ok('«без цвета»: полоска снята, на сервер ушёл null', !orgCards()[0].classList.contains('colored') && posts.some(p => p.colors && Object.values(p.colors)[0] === null));
  d.querySelector('[data-act="sheet-close"]').click(); await wait();
  // чужой профиль
  await click('[data-act="profile"][data-p="me"]');
  ok('чужой профиль: метка владельца видна (#3e63dd)', !!d.querySelector('.lesson.colored') && d.querySelector('.lesson.colored').getAttribute('style').includes('#3e63dd'));
  await click('.lesson[data-act="open"]');
  ok('чужой лист: палитры нет', !d.querySelector('#swatches'));
  if (errs.length) console.log('JS ERRORS', errs);
  dom.window.close(); process.exit(0);
})();
