// Гонки сетевых запросов на клиенте (js/state.js): load(), loadQuiet(), loadState(), loadChanges()
// могут запускаться повторно, не дожидаясь предыдущего вызова, и отвечать не в том порядке, в каком
// ушли запросы. Проверяем, что применяется только самый ПОСЛЕДНИЙ запущенный запрос, а более ранние,
// пришедшие позже (успешные или с ошибкой), тихо отбрасываются.
//
// Внутреннее состояние (const state в js/state.js) не попадает в window — top-level const/let
// не становятся свойствами window, в отличие от function/var (см. client-global-names.js).
// Поэтому весь тест наблюдает только через DOM (textContent), как это делает настоящий браузер;
// доступны на window лишь функции: load, loadQuiet, loadState, loadChanges, render.
//
// Порядок ответов управляется вручную через deferred-промисы — без sleep() на исход, чтобы тест
// не был плавающим; статичные паузы только чтобы дать микрозадачам／таймерам прогнаться.
const html = require('./load.js');
const { JSDOM } = require('jsdom');

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const jsonResp = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
// Расписание с одной парой сегодня (2026-09-19) и узнаваемым названием — по нему в DOM видно,
// какой из гоночных ответов победил.
const sched = (mark, subject) => ({
  profile: 'x', group: 'G', fetchedAt: '2026-09-19T0' + mark + ':00:00.000Z', errors: [],
  lessons: subject ? [{ id: mark, date: '2026-09-19', start: '08:00', end: '09:30', startAt: '2026-09-19T08:00:00', endAt: '2026-09-19T09:30:00',
    num: 1, kind: 'лек', subject, title: 'лек ' + subject, teacher: 'Т', room: '1', color: null, subgroup: 0, weekType: 1, replaced: false }] : [],
});
const wait = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const ok = (name, cond, info) => console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (cond ? '' : '   ' + JSON.stringify(info)));

async function boot({ withTelegram = false } = {}) {
  const calls = [];
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://parket-2.vercel.app/', pretendToBeVisual: true,
    beforeParse(w) {
      w.__NOW = '2026-09-19T07:00:00';
      if (withTelegram) w.Telegram = { WebApp: { initData: 'fake', ready(){}, expand(){}, colorScheme: 'light', showConfirm(m, cb){ cb(true); } } };
      w.fetch = (url) => { const d = deferred(); calls.push({ url, ...d }); return d.promise; };
    } });
  await wait(30); // дать стартовым load()/loadQuiet()/loadState() зарегистрировать свои fetch
  return { dom, w: dom.window, txt: () => dom.window.document.getElementById('app').textContent.replace(/\s+/g, ' ').trim(), calls };
}
// следующий ещё не тронутый вызов на этот путь (порядок резолва можно задавать любой)
const nextCall = (calls, urlPart, used) => { const c = calls.filter((x) => x.url.includes(urlPart) && !used.has(x)).shift(); if (c) used.add(c); return c; };

(async () => {
  // ---------- A: устаревшая ОШИБКА не должна перекрыть более новый УСПЕХ (тот же профиль) ----------
  {
    const { w, txt, calls } = await boot();
    const used = new Set();
    const c1 = nextCall(calls, 'profile=me', used); // стартовый load('me')
    w.load('me'); // ручной повторный вызов
    await wait();
    const c2 = nextCall(calls, 'profile=me', used);
    ok('оба запроса на profile=me зарегистрированы', !!c1 && !!c2 && c1 !== c2);
    c2.resolve(jsonResp(sched(2, 'Второй ответ'))); // новый запрос отвечает первым — успешно
    await wait();
    ok('после успеха второго: пара видна, ошибки нет', txt().includes('Второй ответ') && !txt().includes('Не удалось'), txt());
    c1.reject(new Error('boom')); // теперь отвечает первый (устаревший) запрос — с ошибкой
    await wait();
    ok('устаревшая ошибка первого запроса не перекрыла успех: баннера ошибки нет, «Второй ответ» на месте', !txt().includes('Не удалось') && !txt().includes('boom') && txt().includes('Второй ответ'), txt());
  }

  // ---------- B: устаревший УСПЕХ не должен стереть более новую ОШИБКУ (тот же профиль) ----------
  {
    const { w, txt, calls } = await boot();
    const used = new Set();
    const c1 = nextCall(calls, 'profile=me', used);
    w.load('me');
    await wait();
    const c2 = nextCall(calls, 'profile=me', used);
    c2.reject(new Error('свежая ошибка')); // новый запрос отвечает первым — с ошибкой
    await wait();
    ok('новая ошибка показана', txt().includes('свежая ошибка'), txt());
    c1.resolve(jsonResp(sched(1, 'Устаревшие данные'))); // устаревший запрос отвечает успехом позже
    await wait();
    ok('устаревший успех не стёр новую ошибку и не подставил свои старые данные', txt().includes('свежая ошибка') && !txt().includes('Устаревшие данные'), txt());
  }

  // ---------- C: load() и loadQuiet() для ОДНОГО профиля пишут в одно поле — гонка между ними ----------
  {
    const { w, txt, calls } = await boot();
    const used = new Set();
    const c1 = nextCall(calls, 'profile=me', used); // стартовый load('me')
    w.loadQuiet('me');
    await wait();
    const c2 = nextCall(calls, 'profile=me', used); // loadQuiet('me')
    c2.resolve(jsonResp(sched(2, 'От loadQuiet'))); // более новый по счётчику отвечает первым
    await wait();
    ok('loadQuiet применил свои данные', txt().includes('От loadQuiet'));
    c1.resolve(jsonResp(sched(1, 'От исходного load'))); // исходный load() отвечает позже, но он старее
    await wait();
    ok('устаревший ответ load() не перезаписал более новые данные от loadQuiet()', txt().includes('От loadQuiet') && !txt().includes('От исходного load'), txt());
    ok('«Обновляю…» корректно снят (индикатором распоряжается именно load())', !txt().includes('Обновляю…'));
  }

  // ---------- D: ошибка на ОДНОМ профиле не должна быть видна при просмотре ДРУГОГО ----------
  {
    const { w, txt, calls } = await boot();
    const used = new Set();
    const cMe = nextCall(calls, 'profile=me', used);
    const cHer = nextCall(calls, 'profile=her', used);
    ok('стартовые запросы ушли на оба профиля', !!cMe && !!cHer);
    cMe.reject(new Error('только у Кирилла'));
    cHer.resolve(jsonResp(sched(9, 'Пара у Маши')));
    await wait();
    ok('на своём экране (по умолчанию — Кирилл) ошибка видна', txt().includes('только у Кирилла'));
    w.document.querySelector('.switch [data-act="profile"][data-p="her"]').click();
    await wait();
    ok('после переключения на профиль Маши чужая (её) ошибка не показывается', !txt().includes('только у Кирилла') && txt().includes('Пара у Маши'), txt());
  }

  // ---------- E: loadState() — устаревший ответ не должен откатывать более новые данные ----------
  {
    const { w, txt, calls } = await boot({ withTelegram: true });
    const used = new Set();
    nextCall(calls, 'profile=me', used).resolve(jsonResp(sched(0))); // расписание нужно, чтобы отрисовался экран «Сегодня» со списком ДЗ
    nextCall(calls, 'profile=her', used).resolve(jsonResp(sched(0)));
    const c1 = nextCall(calls, '/api/state', used); // стартовый loadState()
    ok('стартовый /api/state запрос ушёл', !!c1);
    w.loadState(); // ручной повторный вызов
    await wait();
    const c2 = nextCall(calls, '/api/state', used);
    const freshDoc = { hw: { x: { name: 'X', text: 'свежее ДЗ', done: false } }, done: {}, colors: {}, custom: {}, prefs: {} };
    const emptyDoc = { hw: {}, done: {}, colors: {}, custom: {}, prefs: {} };
    c2.resolve(jsonResp({ who: 'me', docs: { me: freshDoc, her: emptyDoc } })); // новый запрос отвечает первым
    const staleDoc = { hw: {}, done: {}, colors: {}, custom: {}, prefs: {} }; // «старое» состояние без этого ДЗ
    c1.resolve(jsonResp({ who: 'me', docs: { me: staleDoc, her: emptyDoc } })); // устаревший запрос отвечает следом
    await wait();
    ok('в итоге видно свежее ДЗ, устаревший (пустой) ответ его не стёр', txt().includes('свежее ДЗ'), txt());
  }

  // ---------- F: loadState() — устаревший ОТКАЗ не должен перекрыть более новый успех ----------
  {
    const { w, txt, calls } = await boot({ withTelegram: true });
    const used = new Set();
    nextCall(calls, 'profile=me', used).resolve(jsonResp(sched(0)));
    nextCall(calls, 'profile=her', used).resolve(jsonResp(sched(0)));
    const c1 = nextCall(calls, '/api/state', used);
    w.loadState();
    await wait();
    const c2 = nextCall(calls, '/api/state', used);
    const doc = { hw: { y: { name: 'Y', text: 'после успешной синхронизации', done: false } }, done: {}, colors: {}, custom: {}, prefs: {} };
    const empty = { hw: {}, done: {}, colors: {}, custom: {}, prefs: {} };
    c2.resolve(jsonResp({ who: 'me', docs: { me: doc, her: empty } })); // новый запрос отвечает первым — успешно
    c1.resolve(jsonResp({}, 503)); // устаревший запрос отвечает позже отказом «не настроено»
    await wait();
    ok('устаревший 503 не откатил уже полученные данные (ДЗ по-прежнему на экране)', txt().includes('после успешной синхронизации'), txt());
    ok('и не показывает баннер «хранилище не настроено» поверх рабочего состояния', !txt().includes('не настроено'));
  }

  // ---------- регрессия: обычная (без гонки) загрузка по-прежнему работает как раньше ----------
  {
    const { w, txt, calls } = await boot();
    ok('во время загрузки показано «Загружаю расписание…»', txt().includes('Загружаю расписание'));
    nextCall(calls, 'profile=me', new Set()).resolve(jsonResp(sched(1, 'Обычная пара')));
    await wait();
    ok('после ответа расписание показано, ошибки нет, «Обновлено» на месте', !txt().includes('Не удалось') && txt().includes('Обычная пара') && txt().includes('Обновлено в'), txt());
  }
  process.exit(0);
})();
