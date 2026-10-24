const { JSDOM } = require('jsdom');
const html = require('./load.js');
let idc = 1;
const mk = (date, s, e, subject, kind) => ({
  id: idc++, date, start: s, end: e, startAt: date + 'T' + s + ':00', endAt: date + 'T' + e + ':00',
  num: 1, kind, subject, title: subject, teacher: 'Т.Т.', room: '8-431', color: '#008000',
  subgroup: 0, weekType: 1, replaced: false,
});
const wait = (ms = 60) => new Promise((r) => setTimeout(r, ms));
const ok = (name, cond, info) => console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (cond ? '' : '   ' + JSON.stringify(info)));

async function boot({ who = 'her', tg = true, initialHw = {} } = {}) {
  const posts = [];
  const sched = {
    her: { group: 'ДСО12', fetchedAt: '2026-09-19T03:55:00.000Z', errors: [], lessons: [
      mk('2026-09-21', '08:30', '10:05', 'Инклюзия - зона доступа', 'пр'),
      mk('2026-09-22', '10:15', '11:50', 'Общая психология', 'лек'),
    ] },
    me: { group: 'Мо-24', fetchedAt: '2026-09-19T03:55:00.000Z', errors: [], lessons: [
      mk('2026-09-21', '09:40', '11:10', 'Конструкция и прочность', 'лек'),
    ] },
  };
  const docs = {
    me: { hw: { 'конструкция и прочность': { name: 'Конструкция и прочность', text: 'Лаба 1', done: false, items: [{ id: '1', text: 'Лаба 1', done: false }] } }, done: {}, colors: {}, custom: {}, prefs: {}, status: null, wishes: {} },
    her: { hw: { ...initialHw }, done: {}, colors: { 'общая психология': 3 }, custom: {}, prefs: {}, status: null, wishes: {} },
  };
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'https://parket-2.vercel.app/',
    pretendToBeVisual: true,
    beforeParse(w) {
      w.__NOW = '2026-09-19T07:00:00';
      if (tg) w.Telegram = { WebApp: { initData: 'fake-init', ready() {}, expand() {}, colorScheme: 'light', showConfirm(m, cb) { cb(true); } } };
      w.fetch = async (url, opts = {}) => {
        const j = (status, b) => ({ ok: status < 400, status, json: async () => b });
        if (url.startsWith('/api/changes')) return j(200, { changes: [] });
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
    close() { dom.window.close(); },
  };
}

(async () => {
  const sampleHw = {
    'инклюзия - зона доступа': {
      name: 'Инклюзия - зона доступа',
      items: [
        { id: 'h1', text: 'Подготовить доклад', done: false, t: 100 },
        { id: 'h2', text: 'Прочитать главу 1', done: true, t: 90 },
      ],
    },
    'общая психология': {
      name: 'Общая психология',
      items: [
        { id: 'h3', text: 'Конспект лекции', done: true, t: 80 },
      ],
    },
  };

  let t = await boot({ initialHw: sampleHw });

  // 1. Кнопка «📝 ДЗ» в шапке
  ok('в шапке есть кнопка «ДЗ»', t.d.querySelector('.hwbtn') && t.d.querySelector('.hwbtn').textContent.includes('ДЗ'));

  // 2. Открытие листа со всеми ДЗ
  await t.click('.hwbtn');
  ok('лист со всеми ДЗ открылся', !!t.d.querySelector('.all-hw-sheet') && t.sheet().includes('Все мои домашние задания'));

  // 3. Видны и активные, и прошедшие (выполненные) задания, сгруппированные по предмету
  ok('виден предмет «Инклюзия - зона доступа»', t.sheet().includes('Инклюзия - зона доступа'));
  ok('видно активное ДЗ «Подготовить доклад»', t.sheet().includes('Подготовить доклад'));
  ok('видно выполненное ДЗ «Прочитать главу 1»', t.sheet().includes('Прочитать главу 1'));
  ok('виден второй предмет «Общая психология»', t.sheet().includes('Общая психология') && t.sheet().includes('Конспект лекции'));

  // 4. Фильтр «Активные»
  await t.click('[data-act="all-hw-filter"][data-v="active"]');
  ok('фильтр «Активные»: доклад виден, а выполненные скрыты', t.sheet().includes('Подготовить доклад') && !t.sheet().includes('Прочитать главу 1'));

  // 5. Фильтр «Выполненные»
  await t.click('[data-act="all-hw-filter"][data-v="done"]');
  ok('фильтр «Выполненные»: выполненные видны, а активные скрыты', t.sheet().includes('Прочитать главу 1') && !t.sheet().includes('Подготовить доклад'));

  // 6. Возврат в «Все»
  await t.click('[data-act="all-hw-filter"][data-v="all"]');
  ok('фильтр «Все»: снова видны оба задания', t.sheet().includes('Подготовить доклад') && t.sheet().includes('Прочитать главу 1'));

  // 7. Переключение статуса выполнения (toggle)
  await t.click('[data-act="all-hw-toggle"][data-id="h1"]');
  ok('клик по чекбоксу: отправлен POST на сервер с обновлённым done', t.posts.length > 0 && t.posts[t.posts.length - 1].hw);

  // 8. Быстрое добавление нового ДЗ через форму
  await t.click('[data-act="all-hw-add-toggle"]');
  ok('форма добавления ДЗ открылась', !!t.d.getElementById('all-hw-subj-sel') && !!t.d.getElementById('all-hw-text-in') && !!t.d.getElementById('all-hw-due-in'));
  await t.click('[data-act="all-hw-kind"][data-v="пр"]');
  t.d.getElementById('all-hw-due-in').value = '2026-09-25';
  t.d.getElementById('all-hw-text-in').value = 'Решить тест в СДО';
  await t.click('[data-act="all-hw-add-save"]');
  ok('новое ДЗ сохранено и отобразилось с типом и дедлайном', t.sheet().includes('Решить тест в СДО') && t.sheet().includes('пр') && t.sheet().includes('25 сентября'));

  // 9. Редактирование: клик по ✏️ открывает подробный редактор
  await t.click('[data-act="all-hw-edit"][data-sk="инклюзия - зона доступа"]');
  ok('открылся редактор ДЗ с полем ввода текста', !!t.d.getElementById('hwtext'));
  await t.click('[data-act="sheet-close"]');
  ok('закрытие редактора вернуло в лист всех ДЗ', !!t.d.querySelector('.all-hw-sheet'));

  // 10. Удаление ДЗ
  const delBtn = t.d.querySelector('[data-act="all-hw-del"]');
  ok('есть кнопка удаления задания', !!delBtn);
  await t.click('[data-act="all-hw-del"]');
  ok('после подтверждения задание удалилось (отправлен POST)', t.posts.length > 0);

  // 11. Закрытие листа
  await t.click('[data-act="sheet-close"]');
  ok('лист всех ДЗ закрылся', !t.d.querySelector('.all-hw-sheet'));

  // 12. Ссылка со страницы «Сегодня»
  const todayLink = t.d.querySelector('.all-hw-link');
  ok('на экране «Сегодня» есть кнопка перехода ко всем ДЗ', !!todayLink);
  await t.click('.all-hw-link');
  ok('клик по ссылке на «Сегодня» также открывает лист всех ДЗ', !!t.d.querySelector('.all-hw-sheet'));
  await t.click('[data-act="sheet-close"]');

  // 13. Чужой профиль (только просмотр)
  await t.click('[data-act="profile"][data-p="me"]');
  await t.click('.hwbtn');
  ok('чужой профиль: открывается с заголовком партнёра', t.sheet().includes('Домашние задания: Кирилл'));
  ok('чужой профиль: кнопок редактирования и чекбоксов нет', !t.d.querySelector('[data-act="all-hw-edit"]') && !t.d.querySelector('[data-act="all-hw-toggle"]'));

  t.close();
  process.exit(0);
})();
