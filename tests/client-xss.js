// Пользовательские строки (предмет, преподаватель, аудитория, ДЗ, название своей пары, записи
// журнала изменений) должны проходить через esc() перед вставкой в innerHTML — иначе вредоносное
// название пары могло бы выполниться как код. Экранирование уже сделано верно по всему коду;
// этот тест это фиксирует, чтобы будущая правка случайно не заменила innerHTML на «сырой» текст.
const html = require('./load.js');
const { JSDOM } = require('jsdom');

const PAYLOAD = '<img src=x onerror=window.__pwned=1><script>window.__pwned=1</script>"><b>inj</b>';
const wait = (ms = 60) => new Promise((r) => setTimeout(r, ms));
const ok = (name, cond, info) => console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (cond ? '' : '   ' + JSON.stringify(info)));

async function boot({ her, docs } = {}) {
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://parket-2.vercel.app/', pretendToBeVisual: true,
    beforeParse(w) {
      w.__NOW = '2026-09-19T07:00:00';
      w.Telegram = { WebApp: { initData: 'fake', ready(){}, expand(){}, colorScheme: 'light', setHeaderColor(){}, setBackgroundColor(){}, showConfirm(m, cb){ cb(true); } } };
      w.fetch = async (url, opts = {}) => {
        const j = (b) => ({ ok: true, status: 200, json: async () => b });
        if (url.startsWith('/api/schedule')) return j(her || { group: 'ДСО12', fetchedAt: '2026-09-19T03:55:00.000Z', errors: [], lessons: [] });
        if (url === '/api/changes') return j({ items: docs && docs.changes || { me: [], her: [] } });
        if (url === '/api/state' && opts.method === 'POST') return j({ ok: true });
        if (url === '/api/state') return j({ who: 'her', docs: docs || { me: { hw: {}, done: {}, colors: {}, custom: {}, prefs: {} }, her: { hw: {}, done: {}, colors: {}, custom: {}, prefs: {} } } });
      };
    } });
  await wait(160);
  const d = dom.window.document;
  return { dom, d, txt: () => d.getElementById('app').textContent.replace(/\s+/g, ' ').trim(), close() { dom.window.close(); } };
}

(async () => {
  // ---------- вредоносные поля прямо из расписания вуза: предмет, преподаватель, аудитория ----------
  {
    const her = { group: 'ДСО12', fetchedAt: '2026-09-19T03:55:00.000Z', errors: [], lessons: [{
      id: 1, date: '2026-09-19', start: '08:30', end: '10:05', startAt: '2026-09-19T08:30:00', endAt: '2026-09-19T10:05:00',
      num: 1, kind: 'пр', subject: PAYLOAD, title: 'пр ' + PAYLOAD, teacher: PAYLOAD, room: PAYLOAD, color: null, subgroup: 0, weekType: 1, replaced: false,
    }] };
    const t = await boot({ her });
    ok('в DOM нет живого <img onerror> из названия предмета', !t.d.querySelector('img[onerror]'));
    ok('в DOM нет исполнившегося <script>, window.__pwned не установлен', !t.dom.window.__pwned);
    ok('текст пары виден как обычный (безопасный) текст, «inj» никуда не пропал', t.txt().includes('inj'));
    // Проверка идёт по РЕАЛЬНЫМ DOM-элементам, а не по сырой строке .innerHTML: после разбора
    // markup атрибуты (например data-k) законно могут содержать символы <, >, " внутри значения —
    // браузер их не перепарсивает как разметку, и при чтении .innerHTML обратно они показываются
    // как есть — это не уязвимость. Уязвимостью было бы появление настоящего <img>-ЭЛЕМЕНТА.
    ok('во всём #app не появилось ни одного настоящего элемента <img> (в приложении их не бывает)', !t.d.getElementById('app').querySelector('img'));
    t.close();
  }

  // ---------- ДЗ и своя пара — то, что вводит сам пользователь ----------
  {
    const her = { group: 'ДСО12', fetchedAt: '2026-09-19T03:55:00.000Z', errors: [], lessons: [{
      id: 2, date: '2026-09-19', start: '08:30', end: '10:05', startAt: '2026-09-19T08:30:00', endAt: '2026-09-19T10:05:00',
      num: 1, kind: 'пр', subject: 'Обычный предмет', title: 'пр Обычный предмет', teacher: 'Т', room: '1', color: null, subgroup: 0, weekType: 1, replaced: false,
    }] };
    const docs = { who: 'her', docs: {
      me: { hw: {}, done: {}, colors: {}, custom: {}, prefs: {} },
      her: {
        hw: { 'обычный предмет': { name: PAYLOAD, text: PAYLOAD, done: false, t: 1 } },
        done: {}, colors: {},
        custom: { c1: { title: PAYLOAD, kind: '', date: '2026-09-19', start: '12:00', end: '13:00', room: PAYLOAD, teacher: PAYLOAD } },
        prefs: {},
      },
    } };
    const t = await boot({ her, docs });
    ok('ДЗ с вредоносным текстом не создаёт живой <img onerror>', !t.d.querySelector('img[onerror]'));
    ok('название своей пары тоже экранировано (нет исполнившегося <script>)', !t.dom.window.__pwned);
    ok('ни ДЗ, ни своя пара не создали настоящий элемент <img> где-либо в #app', !t.d.getElementById('app').querySelector('img'));
    t.close();
  }

  // ---------- журнал изменений расписания ----------
  {
    const her = { group: 'ДСО12', fetchedAt: '2026-09-19T03:55:00.000Z', errors: [], lessons: [] };
    const docs = { who: 'her', docs: {
      me: { hw: {}, done: {}, colors: {}, custom: {}, prefs: {} },
      her: { hw: {}, done: {}, colors: {}, custom: {}, prefs: {} },
    }, changes: { her: [{ id: 'c1', t: '2026-09-19T05:00:00.000Z', type: 'added', date: '2026-09-25', text: 'Добавлена: ' + PAYLOAD, fields: [] }], me: [] } };
    const t = await boot({ her, docs });
    ok('текст записи журнала изменений тоже безопасен (нет живого onerror)', !t.d.querySelector('img[onerror]') && !t.dom.window.__pwned);
    t.close();
  }
  process.exit(0);
})();
