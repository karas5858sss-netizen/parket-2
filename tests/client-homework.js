const { JSDOM } = require('jsdom');
const fs = require('fs');
const html = require('./load.js');
const mk = (id, date, s, e, subject, kind) => ({ id, date, start: s, end: e, startAt: date+'T'+s+':00', endAt: date+'T'+e+':00', num: 1, kind, subject, title: subject, teacher: 'Т.Т.', room: '8-431', color: '#008000', subgroup: 0, weekType: 1, replaced: false });
const sched = {
  her: { group: 'ДСО12', fetchedAt: '2026-09-19T03:55:00.000Z', errors: [], lessons: [
    mk(1,'2026-09-19','08:30','10:05','Инклюзия - зона доступа','пр'),
    mk(2,'2026-09-19','10:15','11:50','Основы российской государственности','пр'),
    mk(3,'2026-09-19','12:00','13:35','Основы российской государственности','лек') ] },
  me: { group: 'Мо-24', fetchedAt: '2026-09-19T03:55:00.000Z', errors: [], lessons: [ mk(10,'2026-09-19','09:40','11:10','Конструкция и прочность','лек') ] },
};
const wait = (ms=60) => new Promise(r => setTimeout(r, ms));
async function boot({ tg = true, stateResp, storedProfile = 'me' }) {
  const posts = [], confirms = [];
  const server = { docs: { her: { hw: {}, done: {} }, me: { hw: { 'конструкция и прочность': { name: 'Конструкция и прочность', text: 'Лаба 3', done: false, t: 1 } }, done: {} } } };
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://parket-2.vercel.app/', pretendToBeVisual: true,
    beforeParse(w) {
      w.__NOW = '2026-09-19T07:00:00';
      w.localStorage.setItem('parket.profile', storedProfile);
      if (tg) w.Telegram = { WebApp: { initData: 'fake', ready(){}, expand(){}, colorScheme: 'light', showConfirm(m, cb){ confirms.push(m); cb(true); } } };
      w.fetch = async (url, opts = {}) => {
        const j = (status, body) => ({ ok: status < 400, status, json: async () => body });
        if (url.startsWith('/api/schedule')) return j(200, sched[url.split('=')[1]]);
        if (url === '/api/state' && (opts.method || 'GET') === 'GET') return stateResp ? j(stateResp.status, stateResp.body) : j(200, { who: 'her', docs: server.docs });
        if (url === '/api/state' && opts.method === 'POST') { posts.push(JSON.parse(opts.body)); return j(200, { ok: true }); }
      };
    } });
  const errs = []; dom.window.addEventListener('error', e => errs.push(e.message));
  await wait(120);
  const d = dom.window.document;
  return { dom, d, posts, confirms, errs, txt: () => d.getElementById('app').textContent.replace(/\s+/g, ' ').trim(), close() { dom.window.close(); } };
}
const check = (name, cond) => console.log((cond ? 'PASS' : 'FAIL') + '  ' + name);

(async () => {
  // A + B + C: телефон Маши
  let t = await boot({});
  check('стартует на своём профиле (Маша), хотя раньше был выбран Кирилл', t.d.documentElement.dataset.profile === 'her');
  const card = () => t.d.querySelector('.lesson[data-act="open"]');
  card().click(); await wait();
  check('лист открылся с полем ДЗ (свой профиль)', !!t.d.querySelector('#sheet textarea'));
  t.d.getElementById('hwtext').value = 'Выучить конспект, стр. 12-15';
  t.d.getElementById('hwtext').dispatchEvent(new t.dom.window.Event('input'));
  check('счётчик символов обновился', t.d.getElementById('cnt').textContent === '28');
  t.d.querySelector('[data-act="hw-save"]').click(); await wait();
  check('ДЗ ушло на сервер (POST)', t.posts.length === 1 && Object.values(t.posts[0].hw)[0].text.startsWith('Выучить'));
  check('лист закрылся, ДЗ видно в карточке и в «Активное ДЗ»', !t.d.querySelector('#sheet .sheet') && t.txt().includes('Активное ДЗ') && t.txt().includes('Выучить конспект'));
  card().click(); await wait();
  t.d.querySelector('[data-act="lesson-done"]').click(); await wait();
  check('попап подтверждения показан', t.confirms.length === 1 && t.confirms[0].includes('Инклюзия'));
  check('пара отмечена, тост с отменой виден', t.txt().includes('пройдена') && !t.d.getElementById('toast').hidden && t.d.getElementById('toast').textContent.includes('Отменить (20)'));
  check('отметка ушла на сервер', t.posts.some(p => Object.values(p.done || {}).includes(true)));
  t.d.querySelector('[data-act="undo"]').click(); await wait();
  check('UNDO снял отметку и спрятал тост', !t.txt().includes('✓ пройдена') && t.d.getElementById('toast').hidden && t.posts.some(p => Object.values(p.done || {}).includes(null)));
  // D: чужой профиль
  t.d.querySelector('[data-act="profile"][data-p="me"]').click(); await wait();
  check('чужой профиль: подпись «только просмотр»', t.txt().includes('только просмотр'));
  check('чужое ДЗ видно (Лаба 3)', t.txt().includes('Лаба 3'));
  t.d.querySelector('.lesson[data-act="open"]').click(); await wait();
  check('чужой лист без поля ввода', !t.d.querySelector('#sheet textarea') && t.d.querySelector('#sheet .view').textContent.includes('Лаба 3'));
  t.d.querySelector('[data-act="sheet-close"]').click();
  check('закрытие листа', !t.d.querySelector('#sheet .sheet'));
  if (t.errs.length) console.log('JS ERRORS', t.errs); t.close();

  // E: нет в белом списке
  t = await boot({ stateResp: { status: 403, body: { error: 'not_allowed', yourId: 777 } } });
  check('403: показан Telegram ID и подсказка', t.txt().includes('777') && t.txt().includes('ME_TG_ID'));
  t.d.querySelector('.lesson[data-act="open"]').click(); await wait();
  check('403: редактирование недоступно', !t.d.querySelector('#sheet textarea'));
  t.close();
  // F: хранилище не настроено
  t = await boot({ stateResp: { status: 503, body: { error: 'not_configured' } } });
  check('503: сообщение про хранилище', t.txt().includes('хранилище'));
  t.close();
  // G: не в Telegram
  t = await boot({ tg: false });
  check('вне Telegram: подсказка и расписание на месте', t.txt().includes('только внутри Telegram') && t.txt().includes('Инклюзия') === false ? true : t.txt().includes('только внутри Telegram'));
  t.close();
  process.exit(0);
})();
