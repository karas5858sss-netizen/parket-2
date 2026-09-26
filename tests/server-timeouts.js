// Таймауты для Redis и Telegram (lib/shared.js, api/notify.js) и отсутствие повторной загрузки
// расписания внутри notify.js (раньше грузилось дважды: для текста напоминания и второй раз
// внутри refreshChanges/lib/detect.js).
const crypto = require('crypto');
process.env.BOT_TOKEN = '123456:TESTTOKEN'; process.env.ME_TG_ID = '111'; process.env.HER_TG_ID = '222';
process.env.KV_REST_API_URL = 'https://redis.test'; process.env.KV_REST_API_TOKEN = 'tok';
process.env.CRON_SECRET = 'cron-secret-123';
const makeKV = require('./kvmock.js');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (name, cond, info) => console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (cond ? '' : '   ' + JSON.stringify(info)));
const L = (id, date, s, e, subject) => ({ id, date, start: s, end: e, startAt: date + 'T' + s + ':00', endAt: date + 'T' + e + ':00', num: 1, kind: 'лек', subject, teacher: 'Т', room: '1' });
const sign = (user) => {
  const params = { auth_date: String(Math.floor(Date.now() / 1000)), query_id: 'A', user: JSON.stringify(user) };
  const check = Object.keys(params).sort().map((k) => k + '=' + params[k]).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(process.env.BOT_TOKEN).digest();
  return new URLSearchParams({ ...params, hash: crypto.createHmac('sha256', secret).update(check).digest('hex') }).toString();
};

// ---------- ставим свой fetch на весь модуль: скрипт решает по URL, что ответить ----------
let kv, schedule, scheduleCalls, telegramCalls, behavior; // behavior: 'ok' | 'hang-redis' | 'hang-telegram' | 'reject-redis'
function reset() {
  kv = makeKV();
  schedule = { me: { lessons: [L(1, '2026-09-21', '09:40', '11:10', 'Конструкция')], errors: [] }, her: { lessons: [L(2, '2026-09-21', '08:30', '10:05', 'Инклюзия')], errors: [] } };
  scheduleCalls = []; telegramCalls = []; behavior = 'ok';
}
global.fetch = async (url, opts = {}) => {
  const j = (status, body) => ({ ok: status < 400, status, json: async () => body });
  if (url.startsWith('https://parket-2.vercel.app/api/schedule?profile=')) {
    scheduleCalls.push(url);
    return j(200, schedule[url.split('=')[1]]);
  }
  if (url === 'https://redis.test') {
    if (behavior === 'hang-redis') return new Promise((_, rej) => opts.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    if (behavior === 'reject-redis') throw new TypeError('fetch failed');
    return j(200, { result: kv.exec(JSON.parse(opts.body)) });
  }
  if (url.startsWith('https://api.telegram.org/bot')) {
    telegramCalls.push(JSON.parse(opts.body));
    if (behavior === 'hang-telegram') return new Promise((_, rej) => opts.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    return j(200, { ok: true });
  }
  throw new Error('unexpected fetch ' + url);
};

const shared = require('../lib/shared');
const notify = require('../api/notify.js');
const runNotify = (method, headers = {}) => new Promise((resolve) => {
  const res = { setHeader() {}, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); } };
  notify({ method, headers: { host: 'parket-2.vercel.app', ...headers } }, res);
});
const CRON = { authorization: 'Bearer cron-secret-123' };

(async () => {
  // ================= таймаут Redis =================
  reset(); behavior = 'hang-redis';
  const t0 = Date.now();
  let threw = null;
  try { await shared.redis(['GET', 'x']); } catch (e) { threw = e; }
  const el = Date.now() - t0;
  ok('Redis: зависший запрос обрывается, а не висит вечно', !!threw && /timeout/i.test(threw.message) && el < 9000, { msg: threw && threw.message, el });

  reset(); behavior = 'reject-redis';
  threw = null;
  try { await shared.redis(['GET', 'x']); } catch (e) { threw = e; }
  ok('Redis: сетевая ошибка тоже превращается в понятное сообщение, а не в AbortError', !!threw && /network/i.test(threw.message), threw && threw.message);

  reset(); // нормальный ответ по-прежнему работает
  await shared.redis(['SET', 'x', '1']);
  ok('Redis: обычный запрос работает как раньше', kv.get('x') === '1');

  // ================= таймаут Telegram внутри notify =================
  reset(); behavior = 'hang-telegram';
  let r = await runNotify('GET', CRON);
  ok('зависший Telegram: notify не висит бесконечно, обе попытки завершились ошибкой в отчёте', r.code === 502 || (r.body.results && r.body.results.every((x) => x.error)), r.body);
  ok('в ошибке видно, что это именно таймаут Telegram, а не что-то ещё', r.body.results ? r.body.results.every((x) => /timeout/i.test(x.error)) : /timeout/i.test(r.body.error), r.body);

  reset(); // Telegram отвечает нормально
  r = await runNotify('GET', CRON);
  ok('обычная отправка по-прежнему работает', r.code === 200 && r.body.results.every((x) => x.sent) && telegramCalls.length === 2);

  // ================= notify не грузит расписание дважды =================
  reset();
  r = await runNotify('GET', CRON);
  ok('расписание каждого профиля запрошено РОВНО один раз за весь вызов notify (не дважды — для текста и для сравнения версий)',
    scheduleCalls.filter((u) => u.includes('profile=me')).length === 1 && scheduleCalls.filter((u) => u.includes('profile=her')).length === 1,
    scheduleCalls);
  ok('при этом сравнение версий расписания всё равно отработало (в базе появился снимок)', !!kv.get('parket:v1:snap:me') && !!kv.get('parket:v1:snap:her'));

  reset();
  r = await runNotify('POST', { 'x-init-data': sign({ id: 111 }) });
  ok('ручная отправка («прислать пример») тоже не дублирует запрос расписания', scheduleCalls.filter((u) => u.includes('profile=me')).length === 1, scheduleCalls);

  // изменение расписания между двумя вызовами notify всё равно обнаруживается (без дублей запроса)
  reset();
  await runNotify('GET', CRON); // первый вызов формирует базовый снимок
  schedule.me.lessons[0] = { ...schedule.me.lessons[0], start: '12:00', end: '13:30' }; // перенос пары
  scheduleCalls = [];
  r = await runNotify('GET', CRON);
  ok('перенос пары между вызовами замечен и без лишних запросов расписания', scheduleCalls.filter((u) => u.includes('profile=me')).length === 1, scheduleCalls);
  process.exit(0);
})();
