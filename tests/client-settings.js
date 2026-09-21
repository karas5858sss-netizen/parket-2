const { JSDOM } = require('jsdom');
const fs = require('fs');
const html = require('./load.js');
let idc = 1;
const mk = (date, s, e, subject, kind) => ({ id: idc++, date, start: s, end: e, startAt: date+'T'+s+':00', endAt: date+'T'+e+':00', num: 1, kind, subject, title: subject, teacher: 'Т.Т.', room: '8-431', color: '#008000', subgroup: 0, weekType: 1, replaced: false });
const wait = (ms = 60) => new Promise(r => setTimeout(r, ms));
const ok = (name, cond) => console.log((cond ? 'PASS' : 'FAIL') + '  ' + name);
async function boot({ who = 'her', tg = true, prefs, notifyResp, herLessons, meLessons } = {}) {
  const posts = [], notifyCalls = [];
  const sched = {
    her: { group: 'ДСО12', fetchedAt: '2026-09-19T03:55:00.000Z', errors: [], lessons: herLessons || [mk('2026-09-19','08:30','10:05','Инклюзия','пр')] },
    me: { group: 'Мо-24', fetchedAt: '2026-09-19T03:55:00.000Z', errors: [], lessons: meLessons || [mk('2026-09-19','09:40','11:10','Конструкция','лек')] },
  };
  const docs = { me: { hw: {}, done: {}, colors: {}, custom: {}, prefs: who === 'me' && prefs ? prefs : {} }, her: { hw: {}, done: {}, colors: {}, custom: {}, prefs: who === 'her' && prefs ? prefs : {} } };
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://parket-2.vercel.app/', pretendToBeVisual: true,
    beforeParse(w) {
      w.__NOW = '2026-09-19T07:00:00';
      if (tg) w.Telegram = { WebApp: { initData: 'fake-init', ready(){}, expand(){}, colorScheme: 'light', setHeaderColor(){}, setBackgroundColor(){}, showConfirm(m, cb){ cb(true); } } };
      w.fetch = async (url, opts = {}) => {
        const j = (status, b) => ({ ok: status < 400, status, json: async () => b });
        if (url.startsWith('/api/schedule')) return j(200, sched[url.split('=')[1]]);
        if (url === '/api/notify') { notifyCalls.push({ method: opts.method, init: opts.headers && opts.headers['X-Init-Data'] }); const r = notifyResp || { status: 200, body: { ok: true } }; return j(r.status, r.body); }
        if (url === '/api/state' && opts.method === 'POST') { posts.push(JSON.parse(opts.body)); return j(200, { ok: true }); }
        if (url === '/api/state') return j(200, { who, docs });
      };
    } });
  const errs = []; dom.window.addEventListener('error', e => errs.push(e.message));
  await wait(160);
  const d = dom.window.document;
  return { dom, d, posts, notifyCalls, errs, txt: () => d.getElementById('app').textContent.replace(/\s+/g, ' ').trim(), sheet: () => d.getElementById('sheet').textContent.replace(/\s+/g, ' ').trim(),
    click: async (sel) => { const el = d.querySelector(sel); if (!el) { console.log('  (нет ' + sel + ')'); return; } el.click(); await wait(); }, close() { dom.window.close(); } };
}
const pressed = (t, sel) => t.d.querySelector(sel).getAttribute('aria-pressed') === 'true';
(async () => {
  let t = await boot();
  ok('в шапке кнопка «Настройки»', t.d.querySelector('.themebtn').textContent === 'Настройки');
  await t.click('.themebtn');
  ok('лист «Настройки»: тема + напоминание, по умолчанию «Включено»', t.sheet().includes('Тема') && t.sheet().includes('Вечернее напоминание') && pressed(t, '#notifychips [data-v="1"]') && !pressed(t, '#notifychips [data-v="0"]'));
  await t.click('#notifychips [data-v="0"]');
  ok('«Выключено»: на сервер ушло prefs.notify=false', t.posts.length === 1 && t.posts[0].prefs && t.posts[0].prefs.notify === false);
  ok('чипы переключились', pressed(t, '#notifychips [data-v="0"]') && !pressed(t, '#notifychips [data-v="1"]'));
  t.d.querySelector('[data-act="sheet-close"]').click();
  await t.click('.themebtn');
  ok('после повторного открытия «Выключено» запомнено', pressed(t, '#notifychips [data-v="0"]'));
  await t.click('#notifychips [data-v="1"]');
  ok('«Включено» обратно: prefs.notify=true', t.posts.length === 2 && t.posts[1].prefs.notify === true);
  await t.click('#notify-test');
  ok('«Прислать пример»: POST /api/notify с подписью Telegram, сообщение об успехе', t.notifyCalls.length === 1 && t.notifyCalls[0].method === 'POST' && t.notifyCalls[0].init === 'fake-init' && t.d.getElementById('notify-status').textContent.includes('Отправлено'));
  t.d.querySelector('[data-act="sheet-close"]').click();
  await t.click('[data-act="profile"][data-p="me"]');
  await t.click('.themebtn');
  await t.click('#notifychips [data-v="0"]');
  ok('настройки сохраняются и при открытом профиле партнёра (в свой документ)', t.posts[t.posts.length - 1].prefs.notify === false && Object.keys(t.posts[t.posts.length - 1].hw || {}).length === 0);
  ok('тема тоже переключается из этого листа', (await (async () => { await t.click('[data-act="theme-set"][data-v="dark"]'); return t.d.documentElement.dataset.theme === 'dark'; })()));
  if (t.errs.length) console.log('JS ERRORS', t.errs); t.close();

  t = await boot({ prefs: { notify: false } });
  await t.click('.themebtn');
  ok('сохранённое «Выключено» приходит с сервера', pressed(t, '#notifychips [data-v="0"]'));
  t.close();

  t = await boot({ notifyResp: { status: 502, body: { ok: false, error: 'Forbidden: bot was blocked by the user' } } });
  await t.click('.themebtn'); await t.click('#notify-test');
  ok('бот заблокирован/не запущен: подсказка «нажми Start»', t.d.getElementById('notify-status').textContent.includes('нажми Start'));
  t.close();
  t = await boot({ notifyResp: { status: 503, body: { error: 'not_configured', missing: ['BOT_TOKEN'] } } });
  await t.click('.themebtn'); await t.click('#notify-test');
  ok('не настроен сервер: показано, чего не хватает', t.d.getElementById('notify-status').textContent.includes('BOT_TOKEN'));
  ok('кнопка снова доступна после ответа', !t.d.getElementById('notify-test').disabled);
  t.close();
  t = await boot({ tg: false });
  await t.click('.themebtn');
  ok('вне Telegram: напоминания недоступны, есть пояснение', t.sheet().includes('Работает только внутри Telegram') && !t.d.getElementById('notify-test'));
  t.close();

  // ---------- порог общих окон: ровно 60 минут показываем, 59 нет ----------
  const edge = async (a, b) => {
    const x = await boot({ herLessons: [mk('2026-09-20', a, b, 'Долгая пара', 'пр')], meLessons: [mk('2026-09-19', '09:00', '10:00', 'Другой день', 'лек')] });
    await x.click('[data-tab="cal"]'); await x.click('[data-act="day"][data-date="2026-09-20"]');
    const text = x.d.querySelector('.joint') ? x.d.querySelector('.joint').textContent : ''; x.close(); return text;
  };
  let j = await edge('09:00', '21:00');
  ok('окна ровно по 60 минут показываются (08:00–09:00 и 21:00–22:00)', j.includes('08:00–09:00') && j.includes('21:00–22:00') && j.includes('1 ч'));
  j = await edge('08:59', '21:01');
  ok('окна по 59 минут скрыты → «Общих окон нет»', j.includes('Общих окон нет') && !j.includes('08:00–08:59'));
  process.exit(0);
})();
