// Тест api/schedule.js: недели, нормализация, подгруппы, ошибки источника, повторы, общий лимит времени.
// Источник вуза подменён: тест сам решает, что он отвечает.
const handler = require('../api/schedule.js');
const I = handler.__internals || {};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 864e5;
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const addDays = (s, n) => iso(Date.parse(s + 'T00:00:00Z') + n * DAY);
const monday = (s) => { const d = new Date(s + 'T00:00:00Z'); return addDays(s, -((d.getUTCDay() + 6) % 7)); };
const row = (id, date, s, e, title, extra = {}) => Object.assign({
  'код': id, 'дата': date + 'T00:00:00', 'датаНачала': date + 'T' + s + ':00', 'датаОкончания': date + 'T' + e + ':00',
  'начало': s, 'конец': e, 'дисциплина': title, 'преподаватель': 'Т.Т.', 'аудитория': '2206', 'номерЗанятия': 1,
  'цвет': '#008000', 'номерПодгруппы': 0, 'типНедели': 1, 'замена': false }, extra);

let rows, calls, counts, override;
const reset = (r) => { rows = r || []; calls = []; counts = {}; override = null; };
global.fetch = async (url, opts = {}) => {
  calls.push(url); counts[url] = (counts[url] || 0) + 1;
  const o = override ? await override(url, counts[url], opts) : null;
  if (o && o.delay) {
    await new Promise((res, rej) => {
      const t = setTimeout(res, o.delay);
      opts.signal.addEventListener('abort', () => { clearTimeout(t); rej(Object.assign(new Error('aborted'), { name: 'AbortError' })); });
    });
  }
  if (o === 'network') throw new TypeError('fetch failed');
  if (o === 'hang') return new Promise((_, rej) => opts.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  if (o && o.status) return { ok: o.status < 400, status: o.status, json: async () => { if (o.badJson) throw new SyntaxError('Unexpected token <'); return o.body || {}; } };
  const json = async (b) => ({ ok: true, status: 200, json: async () => b });
  if (url.includes('GetRaspDates')) {
    const ds = [...new Set(rows.map((r) => r['дата'].slice(0, 10)))].sort();
    return json({ data: { minDate: ds[0] || null, maxDate: ds[ds.length - 1] || null, dates: (o && o.dates) || ds } });
  }
  const sdate = new URL(url).searchParams.get('sdate');
  const mon = monday(sdate), sun = addDays(mon, 6);
  return json({ data: { rasp: rows.filter((r) => { const d = String(r['дата']).slice(0, 10); return !/^\d{4}-\d{2}-\d{2}$/.test(d) || (d >= mon && d <= sun); }) } });
};
const run = (query, method = 'GET') => new Promise((resolve) => {
  const res = { h: {}, setHeader(k, v) { this.h[k] = v; }, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b, headers: this.h }); } };
  handler({ query, method }, res);
});
const ok = (name, cond, info) => console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (cond ? '' : '   ' + JSON.stringify(info)));
const rasp = () => calls.filter((u) => u.includes('/Rasp?'));
const base = () => [
  row(1, '2026-09-14', '08:00', '09:30', 'пр. Профессиональный английский язык'),
  row(2, '2026-09-15', '09:40', '11:10', 'лек Конструкция'),
  row(3, '2026-09-21', '11:50', '13:20', 'Лек Физическая культура'),
  row(4, '2026-09-26', '08:00', '09:30', 'лаб Химия'),
  row(5, '2026-10-05', '13:30', '15:00', 'Практика по специальности'),
];

(async () => {
  // ================= как работает сейчас =================
  reset(base());
  let r = await run({ profile: 'x' });
  ok('неизвестный профиль: 400 и список допустимых', r.code === 400 && r.body.allowed.join() === 'me,her', r.body);

  r = await run({ profile: 'me' });
  ok('ответ 200, у пар есть все поля, кэш 15 минут', r.code === 200 && r.headers['Cache-Control'].includes('s-maxage=900') && r.body.lessons.length === 5 && r.body.profile === 'me' && r.body.groupId === 338 && r.body.group === 'Мо-24' && Array.isArray(r.body.errors) && !r.body.errors.length, r.body);
  ok('один запрос на каждую неделю (3 недели → 3 запроса) плюс один за списком дат', rasp().length === 3 && calls.length === 4, calls);
  ok('для недели берётся первая дата из списка', rasp().map((u) => new URL(u).searchParams.get('sdate')).join() === '2026-09-14,2026-09-21,2026-10-05', rasp());
  ok('мой профиль идёт на сервер МГТУ ГА, её профиль на edu.donstu.ru', calls.every((u) => u.startsWith('http://94.180.56.248:8080/api/')) && (await (async () => { reset(base()); await run({ profile: 'her' }); return calls.every((u) => u.startsWith('https://edu.donstu.ru/api/')) && calls[0].includes('idGroup=73381'); })()));

  reset(base());
  r = await run({ profile: 'me' });
  const L = r.body.lessons;
  ok('пары отсортированы по времени', L.map((l) => l.id).join() === '1,2,3,4,5', L.map((l) => l.id));
  ok('тип пары и название: «пр.», «лек», «Лек» (с большой), «лаб»', L[0].kind === 'пр' && L[0].subject === 'Профессиональный английский язык' && L[1].kind === 'лек' && L[2].kind === 'лек' && L[2].subject === 'Физическая культура' && L[3].kind === 'лаб', L.map((l) => [l.kind, l.subject]));
  ok('«Практика…» не принимается за тип «пр» (нужен пробел после приставки)', L[4].kind === null && L[4].subject === 'Практика по специальности' && L[4].title === 'Практика по специальности', L[4]);
  ok('время для сравнения в едином формате ГГГГ-ММ-ДДTЧЧ:ММ:СС', L.every((l) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00$/.test(l.startAt) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00$/.test(l.endAt)) && L[0].startAt === '2026-09-14T08:00:00' && L[0].endAt === '2026-09-14T09:30:00' && L[0].date === '2026-09-14', L[0]);
  ok('остальные поля: преподаватель, аудитория, цвет, замена', L[0].teacher === 'Т.Т.' && L[0].room === '2206' && L[0].color === '#008000' && L[0].replaced === false && L[0].num === 1);

  reset([...base(), row(2, '2026-09-22', '09:40', '11:10', 'лек Дубль в соседнюю неделю')]);
  r = await run({ profile: 'me' });
  ok('одна и та же запись из двух ответов попадает один раз (по номеру пары)', r.body.lessons.filter((l) => l.id === 2).length === 1);

  // ---- подгруппы ----
  const sg = (id, n, extra = {}) => row(id, '2026-09-23', '08:30', '10:05', 'лек ВОЕННАЯ ПОДГОТОВКА, п/г ' + n, Object.assign({ 'преподаватель': 'Полковник' + n, 'аудитория': '11-' + n }, extra));
  reset([sg(11, 2), sg(10, 1), sg(12, 3)]);
  r = await run({ profile: 'me' });
  let c = r.body.lessons;
  ok('три подгруппы одного занятия: одна карточка, варианты по порядку', c.length === 1 && c[0].variants.map((v) => v.n).join() === '1,2,3' && c[0].subject === 'ВОЕННАЯ ПОДГОТОВКА' && c[0].title === 'лек ВОЕННАЯ ПОДГОТОВКА', c);
  ok('в карточке подгрупп нет одной общей аудитории и преподавателя, они лежат в вариантах', c[0].teacher === '' && c[0].room === '' && c[0].variants[1].teacher === 'Полковник2' && c[0].variants[1].room === '11-2');
  reset([sg(10, 1)]);
  c = (await run({ profile: 'me' })).body.lessons;
  ok('одна подгруппа: всё равно карточка с одним вариантом', c.length === 1 && c[0].variants.length === 1 && c[0].variants[0].n === 1, c);
  reset([sg(10, 1), sg(11, 2, { 'дата': '2026-09-24T00:00:00', 'датаНачала': '2026-09-24T08:30:00', 'датаОкончания': '2026-09-24T10:05:00' })]);
  c = (await run({ profile: 'me' })).body.lessons;
  ok('то же название в разные дни не сливается', c.length === 2 && c.every((x) => x.variants.length === 1), c);
  reset([sg(10, 1), row(20, '2026-09-23', '08:30', '10:05', 'лек ДРУГОЕ, п/г 1'), row(21, '2026-09-23', '08:30', '10:05', 'лек Обычная пара')]);
  c = (await run({ profile: 'me' })).body.lessons;
  ok('другое название в то же время не сливается; пары без «п/г» не трогаются', c.length === 3 && c.filter((x) => x.variants).length === 2 && c.find((x) => x.id === 21).variants === undefined, c.map((x) => x.title));
  reset([sg(10, 1, { 'аудитория': '11-201' }), sg(11, 2, { 'аудитория': '11-999', 'преподаватель': 'Другой' })]);
  c = (await run({ profile: 'me' })).body.lessons;
  ok('у подгрупп разные аудитории и преподаватели сохраняются каждой', c[0].variants[0].room === '11-201' && c[0].variants[1].room === '11-999' && c[0].variants[1].teacher === 'Другой', c[0].variants);
  if (I.collapseSubgroups) {
    const norm = [sg(10, 1), sg(11, 2), sg(12, 3)].map(I.normalize);
    const only = I.collapseSubgroups(norm, 3);
    ok('закреплённая подгруппа (номер 3): остаётся только она, без вариантов', only.length === 1 && only[0].subgroup === 3 && only[0].variants === undefined && only[0].room === '11-3', only);
    ok('закреплённая подгруппа, которой в этот день нет, даёт пустой список', I.collapseSubgroups(norm, 5).length === 0);
  } else ok('внутренности модуля доступны тестам (__internals)', false, 'нет __internals');

  // ---- ошибки источника ----
  reset(base());
  override = (url) => (url.includes('sdate=2026-09-21') ? { status: 500 } : null);
  r = await run({ profile: 'me' });
  ok('одна неделя не загрузилась: 200, в errors неделя, остальные пары на месте, без кэша', r.code === 200 && r.body.errors.length === 1 && r.body.errors[0].sdate === '2026-09-21' && r.body.lessons.length === 3 && r.body.lessons.map((l) => l.id).join() === '1,2,5' && r.headers['Cache-Control'] === 'no-store', r.body.errors);
  reset(base());
  override = (url) => (url.includes('/Rasp?') ? { status: 500 } : null);
  r = await run({ profile: 'me' });
  ok('ни одна неделя не загрузилась: 502 и без кэша', r.code === 502 && r.headers['Cache-Control'] === 'no-store' && r.body.errors.length === 3, r.body);

  // ================= новое: политика повторов =================
  const attempts = async (behavior) => { reset(base()); override = (url) => (url.includes('sdate=2026-09-14') ? behavior : null); await run({ profile: 'me' }); return counts[calls.find((u) => u.includes('sdate=2026-09-14'))]; };
  ok('404 не повторяется (1 запрос)', (await attempts({ status: 404 })) === 1);
  ok('403 не повторяется', (await attempts({ status: 403 })) === 1);
  ok('400 не повторяется', (await attempts({ status: 400 })) === 1);
  ok('500 повторяется один раз (2 запроса)', (await attempts({ status: 500 })) === 2);
  ok('503 повторяется', (await attempts({ status: 503 })) === 2);
  ok('429 повторяется', (await attempts({ status: 429 })) === 2);
  ok('408 повторяется', (await attempts({ status: 408 })) === 2);
  ok('сетевая ошибка повторяется', (await attempts('network')) === 2);
  ok('ответ 200, но не JSON (страница-заглушка): не повторяется', (await attempts({ status: 200, badJson: true })) === 1);
  reset(base());
  override = (url, n) => (url.includes('sdate=2026-09-14') && n === 1 ? { status: 500 } : null);
  r = await run({ profile: 'me' });
  ok('после одной ошибки вторая попытка удалась: данные целы, ошибок нет, кэш есть', r.code === 200 && !r.body.errors.length && r.body.lessons.length === 5 && r.headers['Cache-Control'].includes('s-maxage'), r.body.errors);
  if (I.CONFIG) {
    const t0 = I.CONFIG.TIMEOUT_MS; I.CONFIG.TIMEOUT_MS = 30;
    reset(base()); override = (url) => (url.includes('sdate=2026-09-14') ? 'hang' : null);
    const s = Date.now(); r = await run({ profile: 'me' }); const el = Date.now() - s;
    ok('зависший запрос обрывается по таймауту, повторяется один раз, неделя уходит в errors', counts[calls.find((u) => u.includes('sdate=2026-09-14'))] === 2 && r.body.errors.length === 1 && /timeout|abort/i.test(r.body.errors[0].error) && el < 1500, { el, errors: r.body.errors });
    I.CONFIG.TIMEOUT_MS = t0;
  }

  // ================= новое: падение списка дат =================
  reset(base());
  override = (url) => (url.includes('GetRaspDates') ? { status: 500 } : null);
  r = await run({ profile: 'me' });
  ok('сервер вуза не отвечает (список дат 500): сразу 502, недели не запрашиваются', r.code === 502 && rasp().length === 0 && r.headers['Cache-Control'] === 'no-store', { code: r.code, rasp: rasp().length });
  reset(base());
  override = (url) => (url.includes('GetRaspDates') ? 'network' : null);
  r = await run({ profile: 'me' });
  ok('сетевая ошибка на списке дат: тоже сразу 502, без запасного диапазона', r.code === 502 && rasp().length === 0);
  const today = iso(Date.now());
  reset([row(77, today, '08:00', '09:30', 'лек Сегодняшняя')]);
  override = (url) => (url.includes('GetRaspDates') ? { status: 404 } : null);
  r = await run({ profile: 'me' });
  ok('список дат «не найден» (изменился API): запасной диапазон — не больше 10 недель', r.code === 200 && rasp().length <= 10 && rasp().length >= 9 && r.body.lessons.length === 1 && r.body.lessons[0].id === 77, { n: rasp().length, code: r.code });
  reset([row(77, today, '08:00', '09:30', 'лек Сегодняшняя')]);
  override = (url) => (url.includes('GetRaspDates') ? { status: 200, body: { data: { dates: [] } } } : null);
  r = await run({ profile: 'me' });
  ok('список дат пришёл пустым: запасной диапазон (не больше 10 недель)', r.code === 200 && rasp().length <= 10 && rasp().length >= 9 && r.body.lessons.length === 1, { n: rasp().length });
  reset(base());
  override = (url) => (url.includes('GetRaspDates') ? { status: 200, body: { data: { dates: ['2026-09-14', 'мусор', '', null, '2026-13-45', '2026-09-21'] } } } : null);
  r = await run({ profile: 'me' });
  ok('мусорные даты в списке отбрасываются, недели не превращаются в NaN', r.code === 200 && rasp().length === 2 && rasp().every((u) => /sdate=\d{4}-\d{2}-\d{2}$/.test(u)), rasp());

  // ================= новое: общий лимит времени =================
  if (I.CONFIG) {
    const saved = { ...I.CONFIG };
    I.CONFIG.DEADLINE_MS = 140; I.CONFIG.TIMEOUT_MS = 500;
    const many = Array.from({ length: 20 }, (_, i) => row(100 + i, addDays('2026-09-07', i * 7), '08:00', '09:30', 'лек Неделя ' + i));
    reset(many);
    override = (url) => (url.includes('/Rasp?') ? { delay: 40 } : null);
    const s = Date.now(); r = await run({ profile: 'me' }); const el = Date.now() - s;
    ok('общий лимит времени: запрос укладывается в бюджет, поздние недели уходят в errors, ранние сохранены', el < 600 && r.code === 200 && r.body.errors.length > 0 && r.body.lessons.length >= 5 && r.body.errors.every((e) => /deadline|timeout|abort/i.test(e.error)) && r.headers['Cache-Control'] === 'no-store', { el, errors: r.body.errors.length, lessons: r.body.lessons.length });
    Object.assign(I.CONFIG, saved);
  }

  // ================= новое: проверка записей вуза =================
  const bad = [
    row(null, '2026-09-14', '08:00', '09:30', 'лек Без номера', { 'код': undefined }),
    row(31, 'вчера', '08:00', '09:30', 'лек Без даты', { 'дата': 'вчера' }),
    row(32, '2026-09-14', '8:00', '09:30', 'лек Плохое время'),
    row(33, '2026-09-14', '10:00', '09:30', 'лек Конец раньше начала'),
    row(34, '2026-09-14', '11:00', '12:30', '   '),
    row(35, '2026-09-14', '13:00', '14:30', 'лек Единственная нормальная'),
  ];
  reset([...bad, ...Array.from({ length: 40 }, (_, i) => row(200 + i, '2026-09-15', '08:00', '09:30', 'лек Хорошая ' + i))]);
  r = await run({ profile: 'me' });
  ok('битые записи (без номера, даты, времени, конец раньше начала, пустое название) отбрасываются, нормальные остаются', r.code === 200 && r.body.invalid === 5 && r.body.lessons.length === 41 && r.body.lessons.some((l) => l.id === 35), { invalid: r.body.invalid, n: r.body.lessons.length });
  reset([row(1, '2026-09-14', '08:00', '09:30', 'лек Нормальная', { 'датаНачала': 'мусор', 'датаОкончания': null })]);
  r = await run({ profile: 'me' });
  ok('время начала и конца собирается из даты и «начало/конец», а не берётся на веру из датаНачала', r.body.lessons[0].startAt === '2026-09-14T08:00:00' && r.body.lessons[0].endAt === '2026-09-14T09:30:00', r.body.lessons[0]);
  reset(bad);
  r = await run({ profile: 'me' });
  ok('если битых записей больше 20% (и не меньше трёх), ответ считается испорченным: 502, без кэша', r.code === 502 && r.body.error === 'upstream malformed' && r.headers['Cache-Control'] === 'no-store', { code: r.code, body: r.body });
  reset([row(1, '2026-09-14', '08:00', '09:30', 'лек Нормальная'), row(2, 'вчера', '08:00', '09:30', 'лек Одна битая', { 'дата': 'вчера' })]);
  r = await run({ profile: 'me' });
  ok('одна битая запись из двух (меньше трёх): без тревоги, отброшена', r.code === 200 && r.body.invalid === 1 && r.body.lessons.length === 1);

  // ================= новое: метод запроса =================
  reset(base());
  r = await run({ profile: 'me' }, 'POST');
  ok('POST не поддерживается: 405 и заголовок Allow', r.code === 405 && r.headers.Allow === 'GET, HEAD' && calls.length === 0, { code: r.code, h: r.headers });
  r = await run({ profile: 'me' }, 'HEAD');
  ok('HEAD разрешён', r.code === 200);
  process.exit(0);
})();
