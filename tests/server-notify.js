const crypto = require('crypto');
process.env.BOT_TOKEN = '123456:TESTTOKEN';
process.env.ME_TG_ID = '111'; process.env.HER_TG_ID = '222';
process.env.KV_REST_API_URL = 'https://redis.test'; process.env.KV_REST_API_TOKEN = 'tok';
process.env.CRON_SECRET = 'cron-secret-123';
const makeKV = require('./kvmock.js');
let kv;
const REAL_NOW = Date.now;
const setNow = (iso) => { Date.now = () => Date.parse(iso); };
setNow('2026-09-20T17:00:00Z');          // 20:00 МСК, воскресенье -> завтра пн 21.09

const L = (date, s, e, subject, kind, room = '') => ({ id: Math.random(), date, start: s, end: e, startAt: date + 'T' + s + ':00', endAt: date + 'T' + e + ':00', kind, subject, teacher: 'Т.Т.', room });
let sched, docs, tgCalls, tgFail, herSchedDown;
const reset = () => {
  sched = {
    me: [L('2026-09-21','09:40','11:10','Конструкция и прочность','лек','2206 - Аудитория для практических занятий'), L('2026-09-24','09:40','11:10','Горюче-смазочные материалы','лек','2113')],
    her: [L('2026-09-21','08:30','10:05','Инклюзия - зона доступа','пр','8-431'), L('2026-09-21','10:15','11:50','Основы российской государственности','пр','6-402'), L('2026-09-21','14:15','15:50','Общая психология','пр','1-353'), L('2026-09-25','10:15','11:50','Основы российской государственности','лек','1-292')],
  };
  docs = {
    me: { hw: { 'конструкция и прочность': { name: 'Конструкция и прочность', text: 'Лаба 3', done: false, t: 1 }, 'горюче-смазочные материалы': { name: 'Горюче-смазочные материалы', text: 'Реферат', done: false, t: 2 }, 'старое': { name: 'Старое', text: 'Сдано', done: true, t: 3 } },
          done: {}, colors: {}, custom: { e1: { title: 'Английский', kind: 'пр', date: '2026-09-21', start: '18:00', end: '19:30', room: '204', teacher: '', until: '2026-10-05' } }, prefs: {} },
    her: { hw: { 'основы российской государственности': { name: 'Основы российской государственности', text: 'Конспект', done: false, t: 1 } }, done: {}, colors: {}, custom: {}, prefs: {} },
  };
  tgCalls = []; tgFail = null; herSchedDown = false; kv = makeKV();
};
global.fetch = async (url, opts = {}) => {
  const j = (status, body) => ({ ok: status < 400, status, json: async () => body });
  if (/^https:\/\/(parket-2\.vercel\.app|custom\.example\.org)\/api\/schedule\?profile=/.test(url)) {
    const p = url.split('=')[1];
    if (p === 'her' && herSchedDown) return j(500, {});
    return j(200, { lessons: sched[p] });
  }
  if (url === 'https://redis.test') { const cmd = JSON.parse(opts.body); if (cmd[0] === 'GET' && cmd[1].startsWith('parket:v1:doc:')) return j(200, { result: JSON.stringify(docs[cmd[1].split(':').pop()]) }); return j(200, { result: kv.exec(cmd) }); }
  if (url.startsWith('https://api.telegram.org/bot')) {
    const body = JSON.parse(opts.body);
    tgCalls.push(body);
    if (tgFail && String(body.chat_id) === tgFail.chat) return j(403, { ok: false, description: tgFail.msg });
    return j(200, { ok: true });
  }
  throw new Error('unexpected fetch ' + url);
};
const handler = require('../api/notify.js');
const run = (method, headers = {}) => new Promise((resolve) => {
  const res = { h: {}, setHeader(k, v) { this.h[k] = v; }, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); } };
  handler({ method, headers: { host: 'parket-2.vercel.app', ...headers } }, res);
});
const sign = (user) => {
  const params = { auth_date: String(Math.floor(Date.now() / 1000)), query_id: 'A', user: JSON.stringify(user) };
  const check = Object.keys(params).sort().map(k => k + '=' + params[k]).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(process.env.BOT_TOKEN).digest();
  return new URLSearchParams({ ...params, hash: crypto.createHmac('sha256', secret).update(check).digest('hex') }).toString();
};
const ok = (name, cond) => console.log((cond ? 'PASS' : 'FAIL') + '  ' + name);
const CRON = { authorization: 'Bearer cron-secret-123' };
const msgTo = (chat) => (tgCalls.find(c => String(c.chat_id) === chat) || {}).text || '';

(async () => {
  reset();
  ok('GET без секрета: 401', (await run('GET')).code === 401);
  ok('GET с неверным секретом: 401', (await run('GET', { authorization: 'Bearer nope' })).code === 401);
  ok('POST без подписи: 401', (await run('POST', {})).code === 401);
  ok('POST чужой: 403', (await run('POST', { 'x-init-data': sign({ id: 999 }) })).code === 403);
  ok('в Telegram при отказе доступа ничего не ушло', tgCalls.length === 0);
  const saved = process.env.CRON_SECRET; delete process.env.CRON_SECRET;
  const nc = await run('GET', CRON);
  ok('нет CRON_SECRET: 503 и подсказка', nc.code === 503 && nc.body.missing.includes('CRON_SECRET'));
  process.env.CRON_SECRET = saved;

  reset();
  const r = await run('GET', CRON);
  ok('cron: 200, дата завтра 2026-09-21, отправлено обоим', r.code === 200 && r.body.date === '2026-09-21' && r.body.results.every(x => x.sent) && tgCalls.length === 2);
  const me = msgTo('111'), her = msgTo('222');
  ok('чаты: Кириллу 111, Маше 222; HTML и кнопка «Открыть расписание» (web_app)', tgCalls[0].parse_mode === 'HTML' && tgCalls[0].reply_markup.inline_keyboard[0][0].web_app.url === 'https://parket-2.vercel.app');
  ok('Кириллу: заголовок «Завтра, понедельник, 21 сентября»', me.includes('<b>Завтра, понедельник, 21 сентября</b>'));
  ok('Кириллу: пара из вуза с аудиторией (без описания)', me.includes('09:40–11:10 Конструкция и прочность (лек), ауд. 2206') && !me.includes('Аудитория для практических'));
  ok('Кириллу: своя пара из повторяющейся серии', me.includes('18:00–19:30 Английский (пр), ауд. 204'));
  ok('Кириллу: всё активное ДЗ со сроками, выполненное не показано', me.includes('• Конструкция и прочность: Лаба 3 (к завтрашней паре)') && me.includes('• Горюче-смазочные материалы: Реферат (к чт, 24 сентября)') && !me.includes('Сдано'));
  ok('Кириллу: ДЗ отсортировано по сроку (сначала завтрашнее)', me.indexOf('Лаба 3') < me.indexOf('Реферат'));
  ok('Кириллу: занятость Маши одной строкой', me.includes('<b>Маша завтра</b>\nЗанята с 08:30 до 15:50 (пар: 3).'));
  ok('Маше: пары, ДЗ «к завтрашней паре», занятость Кирилла с учётом его своих пар', her.includes('08:30–10:05 Инклюзия - зона доступа (пр), ауд. 8-431') && her.includes('• Основы российской государственности: Конспект (к завтрашней паре)') && her.includes('<b>Кирилл завтра</b>\nЗанят с 09:40 до 19:30 (пар: 2).'));

  reset(); docs.her.prefs = { notify: false };
  const r2 = await run('GET', CRON);
  ok('напоминание выключено у Маши: ей не отправлено, Кириллу отправлено', tgCalls.length === 1 && String(tgCalls[0].chat_id) === '111' && r2.body.results.find(x => x.who === 'her').skipped === 'disabled');

  reset(); docs.me.prefs = { notify: false };
  const r3 = await run('POST', { 'x-init-data': sign({ id: 111 }) });
  ok('«прислать пример»: уходит только нажавшему, даже если напоминания выключены', r3.code === 200 && tgCalls.length === 1 && String(tgCalls[0].chat_id) === '111');

  reset(); herSchedDown = true;
  const r4 = await run('GET', CRON);
  ok('расписание Маши недоступно: Кириллу приходит без блока про Машу', r4.code === 200 && msgTo('111').length > 0 && !msgTo('111').includes('Маша завтра') && r4.body.results.find(x => x.who === 'her').error === 'schedule_unavailable');

  reset(); tgFail = { chat: '222', msg: 'Forbidden: bot was blocked by the user' };
  const r5 = await run('GET', CRON);
  ok('Маша заблокировала бота: cron не падает, ошибка в отчёте, Кириллу ушло', r5.code === 200 && r5.body.results.find(x => x.who === 'her').error.includes('blocked') && r5.body.results.find(x => x.who === 'me').sent);
  const r6 = await run('POST', { 'x-init-data': sign({ id: 222 }) });
  ok('ручной запуск у Маши при ошибке Telegram: 502 с текстом ошибки', r6.code === 502 && r6.body.error.includes('blocked'));

  reset(); setNow('2026-09-26T17:00:00Z');   // завтра воскресенье, пар нет
  docs.me.custom = {};
  await run('GET', CRON);
  ok('пустой день: «Пар нет.», «Маша свободна весь день.»', msgTo('111').includes('Пар нет.') && msgTo('111').includes('Свободна весь день.') && msgTo('222').includes('Свободен весь день.'));
  setNow('2026-09-20T17:00:00Z');

  reset(); docs.me.custom = { x1: { title: '<i>hack</i> & co', kind: '', date: '2026-09-21', start: '12:00', end: '13:00', room: '', teacher: '' } };
  await run('GET', CRON);
  ok('HTML в названиях экранируется', msgTo('111').includes('&lt;i&gt;hack&lt;/i&gt; &amp; co') && !msgTo('111').includes('<i>hack'));

  reset(); docs.me.hw = {}; for (let i = 0; i < 20; i++) docs.me.hw['предмет ' + i] = { name: 'Предмет ' + i, text: 'дз', done: false, t: i };
  await run('GET', CRON);
  ok('длинный список ДЗ: 15 строк и «и ещё 5»', (msgTo('111').match(/^• /gm) || []).length === 15 && msgTo('111').includes('и ещё 5'));
  ok('сообщение короче лимита Telegram (4096)', msgTo('111').length < 4096);

  // ---------- изменения в расписании в вечернем сообщении ----------
  reset();
  const E = (id, t, type, date, text) => ({ id, t, type, date, text, fields: [] });
  kv.exec(['SET', 'parket:v1:chg:me', JSON.stringify([
    E('A', '2026-09-20T15:00:00.000Z', 'moved', '2026-09-21', 'Перенесена: Конструкция (лек), пн 21 сентября 09:40 → 12:00'),
    E('B', '2026-09-20T14:00:00.000Z', 'changed', '2026-09-22', 'Изменено: Автоматика, аудитория 1 → 2'),
    E('C', '2026-09-18T10:00:00.000Z', 'added', '2026-09-23', 'Добавлена: Старая новость'),
    E('D', '2026-09-20T15:30:00.000Z', 'added', '2026-09-19', 'Добавлена: Пара из прошлого'),
    E('E', '2026-09-20T15:40:00.000Z', 'published', null, 'Опубликованы новые пары до 10 октября (+9)'),
  ])]);
  docs.me.prefs = { seen: { me: '2026-09-20T14:30:00.000Z' } };
  await run('GET', CRON);
  const chg = msgTo('111');
  ok('в сообщении раздел «Изменилось в расписании» стоит сразу после даты', chg.indexOf('<b>Изменилось в расписании</b>') > 0 && chg.indexOf('<b>Изменилось в расписании</b>') < chg.indexOf('<b>Твои пары</b>'));
  ok('попали непрочитанные свежие: перенос и «опубликованы»', chg.includes('• Перенесена: Конструкция (лек), пн 21 сентября 09:40 → 12:00') && chg.includes('• Опубликованы новые пары до 10 октября (+9)'));
  ok('не попали: прочитанное, старше 30 часов и уже прошедшее', !chg.includes('Автоматика, аудитория') && !chg.includes('Старая новость') && !chg.includes('Пара из прошлого'));
  ok('Маше раздела нет (в её журнале ничего)', !msgTo('222').includes('Изменилось в расписании'));
  reset(); await run('GET', CRON);
  ok('без изменений раздела нет вовсе', !msgTo('111').includes('Изменилось'));
  // ---------- окно теперь не 30 часов, а срок жизни журнала (см. lib/changes.js LOG_MAX_AGE_DAYS) ----------
  // now = 2026-09-20T17:00. Запись обнаружена ~2 суток назад (2026-09-18T17:00) — при старом
  // окне в 30 часов она бы отсеклась по возрасту; при новом (несколько недель) должна дойти.
  reset();
  kv.exec(['SET', 'parket:v1:chg:me', JSON.stringify([
    E('OLD1', '2026-09-18T17:00:00.000Z', 'added', '2026-09-25', 'Добавлена: Забытая почти двое суток назад'),
  ])]);
  docs.me.prefs = { seen: { me: '2026-09-15T00:00:00.000Z' } }; // прочитано задолго до этой записи — не «уже видел»
  await run('GET', CRON);
  ok('запись старше 30 часов (но новее seen и ещё в будущем) теперь попадает в сообщение — окно расширено', msgTo('111').includes('Забытая почти двое суток назад'), msgTo('111'));

  reset();
  kv.exec(['SET', 'parket:v1:chg:me', JSON.stringify([
    E('OLD1', '2026-09-18T17:00:00.000Z', 'added', '2026-09-25', 'Добавлена: Забытая почти двое суток назад'),
  ])]);
  docs.me.prefs = { seen: { me: '2026-09-19T00:00:00.000Z' } }; // а вот это уже прочитано (seen позже записи)
  await run('GET', CRON);
  ok('но уже прочитанное («seen» новее записи) по-прежнему не показывается', !msgTo('111').includes('Забытая почти двое суток назад'));

  reset();
  kv.exec(['SET', 'parket:v1:chg:me', JSON.stringify(Array.from({ length: 9 }, (_, i) => E('m' + i, '2026-09-20T15:0' + i + ':00.000Z', 'added', '2026-09-22', 'Добавлена: Пара ' + i)))]);
  await run('GET', CRON);
  ok('много изменений: 6 строк и «и ещё 3»', (msgTo('111').match(/^• Добавлена/gm) || []).length === 6 && msgTo('111').includes('и ещё 3'));

  // ---------- нумерация пар в сообщении ----------
  reset();
  await run('GET', CRON);
  const nm = msgTo('111'), nh = msgTo('222');
  ok('у Кирилла номер по его сетке: 09:40 → «2 пара»', nm.includes('2 пара: 09:40–11:10 Конструкция и прочность (лек), ауд. 2206'));
  ok('своя пара не по сетке (18:00) идёт без номера', nm.includes('\n18:00–19:30 Английский (пр), ауд. 204') && !nm.includes('пара: 18:00'));
  ok('у Маши по её сетке: 08:30 → «1 пара», 10:15 → «2 пара», 14:15 → «4 пара»', nh.includes('1 пара: 08:30–10:05 Инклюзия') && nh.includes('2 пара: 10:15–11:50 Основы') && nh.includes('4 пара: 14:15–15:50 Общая психология'));
  reset(); docs.me.custom.e2 = { title: 'Консультация', kind: '', date: '2026-09-21', start: '13:30', end: '15:00', room: '', teacher: '' };
  await run('GET', CRON);
  ok('своя пара, совпавшая с сеткой (13:30), получает номер «4 пара»', msgTo('111').includes('4 пара: 13:30–15:00 Консультация'));

  // ---------- адрес приложения: cron может прийти на закрытый адрес сборки ----------
  reset();
  process.env.VERCEL_PROJECT_PRODUCTION_URL = 'parket-2.vercel.app';
  const rp = await new Promise((resolve) => {
    const res = { setHeader() {}, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); } };
    handler({ method: 'GET', headers: { host: 'parket-2-6x0if92wb-team-projects.vercel.app', authorization: 'Bearer cron-secret-123' } }, res);
  });
  ok('cron пришёл на адрес сборки: запросы и кнопка идут на боевой домен, напоминания отправлены', rp.code === 200 && rp.body.base === 'https://parket-2.vercel.app' && tgCalls.length === 2 && tgCalls[0].reply_markup.inline_keyboard[0][0].web_app.url === 'https://parket-2.vercel.app', rp.body);
  process.env.APP_URL = 'https://custom.example.org/';
  reset();
  const rc = await run('GET', CRON);
  ok('APP_URL важнее всего (слэш в конце убирается)', rc.body.base === 'https://custom.example.org');
  delete process.env.APP_URL; delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
  // ---------- признак «вечерняя отправка настроена» ----------
  reset();
  const rr1 = await run('POST', { 'x-init-data': sign({ id: 111 }) });
  ok('«пример» сообщает, что CRON_SECRET задан (cronReady: true)', rr1.code === 200 && rr1.body.cronReady === true, rr1.body);
  const savedSecret = process.env.CRON_SECRET; delete process.env.CRON_SECRET;
  reset();
  const rr2 = await run('POST', { 'x-init-data': sign({ id: 111 }) });
  ok('без CRON_SECRET «пример» всё равно уходит, но cronReady: false', rr2.code === 200 && rr2.body.cronReady === false && tgCalls.length === 1, rr2.body);
  const rr3 = await run('GET', { authorization: 'Bearer anything' });
  ok('без CRON_SECRET сам cron получает 503 с подсказкой', rr3.code === 503 && rr3.body.missing.includes('CRON_SECRET'), rr3.body);
  process.env.CRON_SECRET = savedSecret;
  Date.now = REAL_NOW; process.exit(0);
})();
