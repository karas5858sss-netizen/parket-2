const { JSDOM } = require('jsdom');
const html = require('./load.js');
let idc = 1;
const mk = (date, s, e, subject, kind) => ({ id: idc++, date, start: s, end: e, startAt: date + 'T' + s + ':00', endAt: date + 'T' + e + ':00', num: 1, kind, subject, title: subject, teacher: 'Т.Т.', room: '8-431', color: '#008000', subgroup: 0, weekType: 1, replaced: false });
const wait = (ms = 60) => new Promise((r) => setTimeout(r, ms));
const ok = (name, cond, info) => console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (cond ? '' : '   ' + JSON.stringify(info)));

async function boot({ who = 'her', tg = true, wishes = {} } = {}) {
  const posts = [];
  const sched = {
    her: { group: 'ДСО12', fetchedAt: '2026-09-19T03:55:00.000Z', errors: [], lessons: [mk('2026-09-19', '08:30', '10:05', 'Инклюзия', 'пр')] },
    me: { group: 'Мо-24', fetchedAt: '2026-09-19T03:55:00.000Z', errors: [], lessons: [mk('2026-09-19', '09:40', '11:10', 'Конструкция', 'лек')] },
  };
  const docs = {
    me: { hw: {}, done: {}, colors: {}, custom: {}, prefs: {}, status: { text: '🚇 Еду домой', t: 1 }, wishes: {} },
    her: { hw: {}, done: {}, colors: {}, custom: {}, prefs: {}, status: null, wishes: { ...wishes } },
  };
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://parket-2.vercel.app/',
    pretendToBeVisual: true,
    beforeParse(w) {
      w.__NOW = '2026-09-19T07:00:00';
      if (tg) w.Telegram = { WebApp: { initData: 'fake-init', ready() {}, expand() {}, colorScheme: 'light', setHeaderColor() {}, setBackgroundColor() {}, showConfirm(m, cb) { cb(true); } } };
      w.fetch = async (url, opts = {}) => {
        const j = (status, b) => ({ ok: status < 400, status, json: async () => b });
        if (url.startsWith('/api/schedule')) return j(200, sched[url.split('=')[1]]);
        if (url === '/api/state' && opts.method === 'POST') { posts.push(JSON.parse(opts.body)); return j(200, { ok: true }); }
        if (url === '/api/state') return j(200, { who, docs });
      };
    },
  });
  await wait(160);
  const d = dom.window.document;
  return {
    dom, d, posts,
    txt: () => d.getElementById('app').textContent.replace(/\s+/g, ' ').trim(),
    sheet: () => d.getElementById('sheet').textContent.replace(/\s+/g, ' ').trim(),
    click: async (sel) => { const el = d.querySelector(sel); if (!el) { console.log('  (нет ' + sel + ')'); return; } el.click(); await wait(); },
    swipe: async (dx, dy = 0) => {
      const touchStart = new dom.window.TouchEvent('touchstart', {
        touches: [{ clientX: 200, clientY: 100 }],
        bubbles: true,
        cancelable: true,
      });
      const touchEnd = new dom.window.TouchEvent('touchend', {
        changedTouches: [{ clientX: 200 + dx, clientY: 100 + dy }],
        bubbles: true,
        cancelable: true,
      });
      d.dispatchEvent(touchStart);
      await wait(10);
      d.dispatchEvent(touchEnd);
      await wait();
    },
    close() { dom.window.close(); },
  };
}

(async () => {
  let t = await boot({ wishes: { w1: { text: 'Сходить в кино на Дюну', cat: 'film', done: false, t: 100 } } });

  // 1. Кнопка «Планы» в шапке
  ok('в шапке есть кнопка «Планы»', t.d.querySelector('.plansbtn') && t.d.querySelector('.plansbtn').textContent.includes('Планы'));

  // 2. Открытие листа планов
  await t.click('.plansbtn');
  ok('лист планов открылся', t.sheet().includes('Совместные планы и идеи') && t.sheet().includes('Сходить в кино на Дюну'));

  // 3. Отметка идеи выполненной
  await t.click('[data-act="wish-toggle"][data-id="w1"]');
  ok('идея отмечена выполненной: отправлен POST с done: true', t.posts.length > 0 && t.posts[t.posts.length - 1].wishes && t.posts[t.posts.length - 1].wishes.w1.done === true);

  // 4. Добавление новой идеи
  const wishIn = t.d.getElementById('wish-in');
  if (wishIn) wishIn.value = 'Попробовать рамен';
  await t.click('[data-act="wish-add"]');
  const lastPost = t.posts[t.posts.length - 1];
  const wishKeys = Object.keys((lastPost && lastPost.wishes) || {});
  ok('добавление идеи: отправлен POST с новой идеей', wishKeys.length > 0 && lastPost.wishes[wishKeys[0]].text === 'Попробовать рамен');

  // 5. Перенос идеи в календарь
  await t.click('[data-act="wish-sched"]');
  ok('перенос идеи открыл форму совместного события', t.sheet().includes('Своё событие') || t.sheet().includes('мероприятие'));

  // 6. Быстрые статусы
  await t.click('[data-act="sheet-close"]');
  ok('в профиле отображаются быстрые статусы', !!t.d.querySelector('.my-status'));
  await t.click('[data-act="status-pick"][data-val="🍕 На обеде"]');
  const statusPost = t.posts[t.posts.length - 1];
  ok('выбор статуса отправил POST со статусом', statusPost && statusPost.status && statusPost.status.text === '🍕 На обеде');

  await t.click('.status-clear-btn');
  const clearPost = t.posts[t.posts.length - 1];
  ok('сброс статуса отправил POST со status: null', clearPost && clearPost.status === null);

  // 7. Свайпы в календаре: неделя
  await t.click('[data-act="tab"][data-tab="cal"]');
  const selBefore = t.d.querySelector('.day[aria-pressed="true"]') ? t.d.querySelector('.day[aria-pressed="true"]').dataset.date : null;
  await t.swipe(-80); // свайп влево -> следующий день
  const selAfter = t.d.querySelector('.day[aria-pressed="true"]') ? t.d.querySelector('.day[aria-pressed="true"]').dataset.date : null;
  ok('свайп влево в «Неделе» переключил день на следующий', selBefore && selAfter && selAfter > selBefore, { selBefore, selAfter });

  // 8. Свайпы в календаре: месяц
  await t.click('[data-act="tab"][data-tab="month"]');
  const mBefore = t.d.querySelector('.wk .rng') ? t.d.querySelector('.wk .rng').textContent : '';
  await t.swipe(-80); // свайп влево -> следующий месяц
  const mAfter = t.d.querySelector('.wk .rng') ? t.d.querySelector('.wk .rng').textContent : '';
  ok('свайп влево в «Месяце» переключил месяц вперед', mBefore && mAfter && mBefore !== mAfter, { mBefore, mAfter });

  t.close();
  process.exit(0);
})();
