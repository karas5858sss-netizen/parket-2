const crypto = require('crypto');
process.env.BOT_TOKEN = '123456:TESTTOKEN'; process.env.ME_TG_ID = '111'; process.env.HER_TG_ID = '222';
process.env.KV_REST_API_URL = 'https://redis.test'; process.env.KV_REST_API_TOKEN = 'tok';
const makeKV = require('./kvmock.js');
let T = Date.parse('2026-09-21T10:00:00Z');                 // 13:00 МСК, понедельник
const REAL = Date.now; Date.now = () => T;
const advance = (min) => { T += min * 60000; };
const L = (id, date, s, e, subject, kind = 'пр', extra = {}) => Object.assign({ id, date, start: s, end: e, subject, kind, teacher: 'Иванов И.И.', room: '8-317' }, extra);
let kv, sched, schedCalls;
const baseMe = () => [L(1,'2026-09-22','09:40','11:10','Конструкция','лек'), L(2,'2026-09-23','09:40','11:10','Горюче-смазочные','лек'), L(3,'2026-09-24','11:50','13:20','Автоматика','лек')];
const baseHer = () => [L(11,'2026-09-22','10:15','11:50','Общая психология'), L(12,'2026-09-25','12:00','13:35','Инклюзия')];
const reset = () => { kv = makeKV(); sched = { me: { lessons: baseMe(), errors: [] }, her: { lessons: baseHer(), errors: [] } }; schedCalls = 0; };
global.fetch = async (url, opts = {}) => {
  const j = (status, body) => ({ ok: status < 400, status, json: async () => body });
  if (url.startsWith('https://parket-2.vercel.app/api/schedule?profile=')) {
    schedCalls++; const s = sched[url.split('=')[1]]; return s ? j(200, s) : j(500, {});
  }
  if (url === 'https://redis.test') return j(200, { result: kv.exec(JSON.parse(opts.body)) });
  throw new Error('unexpected ' + url);
};
const handler = require('../api/changes.js');
const run = (method, headers = {}) => new Promise((resolve) => {
  const res = { setHeader() {}, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); } };
  handler({ method, headers: { host: 'parket-2.vercel.app', ...headers } }, res);
});
const sign = (user) => {
  const params = { auth_date: String(Math.floor(T / 1000)), query_id: 'A', user: JSON.stringify(user) };
  const check = Object.keys(params).sort().map(k => k + '=' + params[k]).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(process.env.BOT_TOKEN).digest();
  return new URLSearchParams({ ...params, hash: crypto.createHmac('sha256', secret).update(check).digest('hex') }).toString();
};
const ok = (name, cond, info) => console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (cond ? '' : '   ' + JSON.stringify(info)));
const ME = { 'x-init-data': '' };
const call = async () => { ME['x-init-data'] = sign({ id: 111 }); return run('GET', ME); };

(async () => {
  reset();
  ok('без подписи: 401', (await run('GET', {})).code === 401);
  ok('чужой: 403 с его id', (await run('GET', { 'x-init-data': sign({ id: 999 }) })).body.yourId === 999);
  ok('POST не поддерживается: 405', (await run('POST', { 'x-init-data': sign({ id: 111 }) })).code === 405);
  ok('запросов расписания при отказе не было', schedCalls === 0);

  reset();
  let r = await call();
  ok('первый вызов: снимок сохранён, журнал пуст (без «потока» изменений)', r.code === 200 && !r.body.items.me.length && !r.body.items.her.length && kv.get('parket:v1:snap:me') && kv.get('parket:v1:snap:her'));
  sched.me.lessons[0].start = '12:00'; sched.me.lessons[0].end = '13:30';        // перенесли пару у Кирилла
  advance(1);
  r = await call();
  ok('второй вызов через 1 минуту: сверка не запускалась (блокировка 5 минут)', !r.body.items.me.length);
  advance(6);
  r = await call();
  const me = r.body.items.me;
  ok('через 7 минут: обнаружен перенос', me.length === 1 && me[0].type === 'moved' && me[0].text === 'Перенесена: Конструкция (лек), вт 22 сентября, 09:40–11:10 → 12:00–13:30', me);
  ok('у записи время обнаружения и номер пары для пометки на карточке', me[0].t === new Date(T).toISOString() && me[0].lid === '1');
  ok('журнал Маши без изменений (профили независимы)', r.body.items.her.length === 0);
  advance(6);
  r = await call();
  ok('повторная сверка без новых правок: дублей нет', r.body.items.me.length === 1);

  // изменения у Маши + добавление + отмена
  sched.her.lessons[0].room = '1-353';
  sched.her.lessons = sched.her.lessons.filter(l => l.id !== 12);
  sched.her.lessons.push(L(13,'2026-09-24','14:15','15:50','Деловая коммуникация'));
  advance(6);
  r = await call();
  const her = r.body.items.her.map(e => e.type).sort();
  ok('у Маши: изменена аудитория, отменена пара, добавлена пара', her.join() === 'added,changed,removed', r.body.items.her);
  ok('Кирилл видит журнал обоих профилей', r.body.items.me.length === 1 && r.body.items.her.length === 3);

  // сбои источника не превращаются в «отмены»
  const snapBefore = kv.get('parket:v1:snap:me');
  sched.me = { lessons: baseMe().slice(0, 1), errors: [{ sdate: '2026-09-28', error: 'HTTP 500' }] };
  advance(6);
  r = await call();
  ok('часть недель не загрузилась: сверка пропущена, снимок не тронут', kv.get('parket:v1:snap:me') === snapBefore && r.body.items.me.length === 1);
  delete sched.me;                                                                    // расписание совсем недоступно
  advance(6);
  r = await call();
  ok('расписание недоступно: журнал остаётся, ошибок клиенту нет', r.code === 200 && r.body.items.me.length === 1);

  // пустой ответ вместо расписания: ждём подтверждения
  reset(); await call(); advance(6);
  sched.me = { lessons: [], errors: [] };
  r = await call();
  ok('пустой ответ №1: не принят, отмен нет', !r.body.items.me.length && JSON.parse(kv.get('parket:v1:snap:me')).sus === 1);
  advance(6); r = await call();
  ok('пустой ответ №2: всё ещё ждём', !r.body.items.me.length && JSON.parse(kv.get('parket:v1:snap:me')).sus === 2);
  advance(6); r = await call();
  ok('пустой ответ №3 подряд: принимаем как есть → 3 отмены', r.body.items.me.length === 3 && r.body.items.me.every(e => e.type === 'removed'), r.body.items.me);
  // ложная тревога: источник вернулся
  reset(); await call(); advance(6);
  sched.me = { lessons: [], errors: [] }; await call(); advance(6);
  sched.me = { lessons: baseMe(), errors: [] }; r = await call();
  ok('источник вернулся после сбоя: изменений нет, счётчик сброшен', !r.body.items.me.length && !JSON.parse(kv.get('parket:v1:snap:me')).sus);

  // новые недели
  reset(); await call(); advance(6);
  sched.me.lessons.push(L(40,'2026-09-29','09:40','11:10','Конструкция','лек'), L(41,'2026-09-30','09:40','11:10','Автоматика','лек'));
  r = await call();
  ok('вуз опубликовал новые недели: одна строка «опубликованы до 30 сентября (+2)»', r.body.items.me.length === 1 && r.body.items.me[0].text === 'Опубликованы новые пары до 30 сентября (+2)', r.body.items.me);

  // удаление старых записей: после даты пары запись пропадает из журнала
  reset(); await call(); advance(6);
  sched.me.lessons[0].start = '12:00'; sched.me.lessons[0].end = '13:30'; await call();
  T = Date.parse('2026-09-24T10:00:00Z'); advance(6);
  r = await call();
  ok('через 3 дня (пара уже прошла) запись убрана из журнала', r.body.items.me.length === 0, r.body.items.me);
  Date.now = REAL; process.exit(0);
})();
