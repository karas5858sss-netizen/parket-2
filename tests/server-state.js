// Тест api/state.js: доступ, права, проверка данных (ДЗ, отметки, цвета, свои пары, настройки).
const crypto = require('crypto');
process.env.BOT_TOKEN = '123456:TESTTOKEN'; process.env.ME_TG_ID = '111'; process.env.HER_TG_ID = '222';
process.env.KV_REST_API_URL = 'https://redis.test'; process.env.KV_REST_API_TOKEN = 'tok';
const makeKV = require('./kvmock.js');
const kv = makeKV();
global.fetch = async (url, opts) => ({ ok: true, status: 200, json: async () => ({ result: kv.exec(JSON.parse(opts.body)) }) });
const handler = require('../api/state.js');

const sign = (user, ageSec = 0) => {
  const params = { auth_date: String(Math.floor(Date.now() / 1000) - ageSec), query_id: 'A', user: JSON.stringify(user) };
  const check = Object.keys(params).sort().map(k => k + '=' + params[k]).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(process.env.BOT_TOKEN).digest();
  return new URLSearchParams({ ...params, hash: crypto.createHmac('sha256', secret).update(check).digest('hex') }).toString();
};
const run = (method, initData, body) => new Promise((resolve) => {
  const res = { setHeader() {}, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b }); } };
  handler({ method, headers: { 'x-init-data': initData }, body }, res);
});
const ok = (name, cond, info) => console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (cond ? '' : '   ' + JSON.stringify(info)));
const ME = () => sign({ id: 111 }), HER = () => sign({ id: 222 });
const doc = async (who, as = ME()) => (await run('GET', as)).body.docs[who];
const good = { title: 'Английский', kind: 'пр', date: '2026-09-21', start: '18:00', end: '19:30', room: '204', teacher: '', until: '2026-10-19' };

(async () => {
  // ---------- доступ ----------
  ok('без подписи: 401', (await run('GET', '')).code === 401);
  ok('испорченная подпись: 401', (await run('GET', ME().replace(/hash=.{4}/, 'hash=0000'))).code === 401);
  ok('просроченная (5 дней): 401', (await run('GET', sign({ id: 111 }, 5 * 86400))).code === 401);
  const st = await run('GET', sign({ id: 999 }));
  ok('чужой пользователь: 403 и его id', st.code === 403 && st.body.yourId === 999);
  const signedBefore = ME(); const tok = process.env.BOT_TOKEN; delete process.env.BOT_TOKEN;
  ok('нет BOT_TOKEN: 503 с подсказкой', (await run('GET', signedBefore)).body.missing.includes('BOT_TOKEN'));
  process.env.BOT_TOKEN = tok;
  ok('метод DELETE: 405', (await run('DELETE', ME())).code === 405);

  // ---------- форма пустого документа и старых документов ----------
  let g = (await run('GET', ME())).body;
  ok('пустой документ: все пять разделов', g.who === 'me' && ['hw', 'done', 'colors', 'custom', 'prefs'].every(k => g.docs.me[k] && typeof g.docs.me[k] === 'object'));
  kv.exec(['SET', 'parket:v1:doc:her', JSON.stringify({ hw: {}, done: {} })]);
  const old = await doc('her');
  ok('старый документ без новых полей читается с пустыми значениями', old.colors && old.custom && old.prefs && !Object.keys(old.custom).length);

  // ---------- ДЗ и отметки ----------
  await run('POST', ME(), { hw: { 'общая психология': { name: 'Общая психология', text: 'x'.repeat(150), done: false }, '__proto__': { text: 'evil' }, ['k'.repeat(200)]: { text: 'long key' } }, done: { '2026-09-19|08:30|инклюзия': true } });
  let d = await doc('me');
  ok('ДЗ обрезается до 100 символов', d.hw['общая психология'].text.length === 100);
  ok('«__proto__» и слишком длинные ключи игнорируются', !Object.prototype.hasOwnProperty.call(d.hw, '__proto__') && Object.keys(d.hw).length === 1);
  ok('отметка «пройдена» сохранена', d.done['2026-09-19|08:30|инклюзия'] > 0);
  ok('партнёр видит чужой документ', Object.keys((await doc('me', HER())).hw).length === 1);
  await run('POST', HER(), { hw: { a: { name: 'A', text: 'hi' } } });
  ok('каждый пишет только в свой документ', Object.keys((await doc('her')).hw).join() === 'a' && Object.keys((await doc('me')).hw).join() === 'общая психология');
  await run('POST', ME(), { hw: { 'общая психология': null }, done: { '2026-09-19|08:30|инклюзия': null } });
  d = await doc('me');
  ok('null удаляет ДЗ и отметку', !Object.keys(d.hw).length && !Object.keys(d.done).length);

  // ---------- цвета ----------
  await run('POST', ME(), { colors: { 'общая психология': 5, 'a16': 16, 'дробь': 1.5, 'строка': 'red', '__proto__': 3 } });
  d = await doc('me');
  ok('цвета: принят только индекс 0–15', JSON.stringify(d.colors) === '{"общая психология":5}', d.colors);
  await run('POST', ME(), { colors: { 'общая психология': null } });
  ok('цвет снимается через null', !Object.keys((await doc('me')).colors).length);

  // ---------- свои пары ----------
  const cases = [
    ['разовая пара', { c1: { title: 'Консультация', kind: '', date: '2026-09-25', start: '10:00', end: '10:45' } }, true],
    ['серия по неделям', { c2: good }, true],
    ['конец раньше начала', { c3: { ...good, end: '17:00' } }, false],
    ['время 25:00', { c4: { ...good, start: '25:00' } }, false],
    ['несуществующая дата 31 февраля', { c5: { ...good, date: '2026-02-31', until: '2026-03-31' } }, false],
    ['пустое название', { c6: { ...good, title: '  ' } }, false],
    ['«повторять до» раньше даты', { c7: { ...good, until: '2026-09-01' } }, false],
    ['серия дольше 400 дней', { c8: { ...good, until: '2028-01-01' } }, false],
    ['недопустимый id', { 'BAD ID!': good }, false],
  ];
  for (const [name, custom, expect] of cases) {
    await run('POST', ME(), { custom });
    ok('свои пары: ' + name + (expect ? ' принята' : ' отклонена'), !!(await doc('me')).custom[Object.keys(custom)[0]] === expect);
  }
  await run('POST', ME(), { custom: { c9: { ...good, kind: 'экз' } } });
  ok('неизвестный тип пары сводится к пустому', (await doc('me')).custom.c9.kind === '');
  await run('POST', ME(), { custom: { c10: { ...good, title: 'Я'.repeat(120) } } });
  ok('название обрезается до 80 символов', (await doc('me')).custom.c10.title.length === 80);
  await run('POST', ME(), { custom: { c11: { ...good, skip: ['2026-10-05', 'мусор', 5, '2026-10-12'] } } });
  ok('пропуски: остаются только настоящие даты', JSON.stringify((await doc('me')).custom.c11.skip) === '["2026-10-05","2026-10-12"]');
  await run('POST', ME(), { custom: { c2: { ...good, room: '305' } } });
  ok('правка заменяет запись', (await doc('me')).custom.c2.room === '305');
  await run('POST', ME(), { custom: { c2: { ...good, end: '10:00' } } });
  ok('неверная правка не портит старую запись', (await doc('me')).custom.c2.room === '305');
  await run('POST', ME(), { custom: { c1: null, c2: null, c9: null, c10: null, c11: null } });
  ok('null удаляет свои пары', !Object.keys((await doc('me')).custom).length);
  const many = {};
  for (let i = 0; i < 305; i++) many['id' + String(i).padStart(4, '0')] = { title: 'x' + i, kind: '', date: '2026-09-21', start: '10:00', end: '11:00' };
  await run('POST', ME(), { custom: many });
  ok('не больше 300 своих пар', Object.keys((await doc('me')).custom).length === 300);
  await run('POST', ME(), { custom: Object.fromEntries(Object.keys(many).map(k => [k, null])) });

  // ---------- настройки ----------
  await run('POST', ME(), { prefs: { notify: false } });
  ok('напоминание можно выключить', (await doc('me')).prefs.notify === false);
  await run('POST', ME(), { prefs: { notify: 'yes', other: 1 } });
  ok('не логическое значение и чужие ключи игнорируются', (await doc('me')).prefs.notify === false && !('other' in (await doc('me')).prefs));
  await run('POST', ME(), { prefs: { notify: true } });
  ok('и включить обратно', (await doc('me')).prefs.notify === true);
  const T1 = '2026-09-20T15:00:00.000Z', T0 = '2026-09-20T10:00:00.000Z';
  await run('POST', ME(), { prefs: { seen: { her: T1, me: 'вчера', evil: T1 } } });
  ok('«прочитано»: принят только правильный формат и ключи me/her', JSON.stringify((await doc('me')).prefs.seen) === JSON.stringify({ her: T1 }));
  await run('POST', ME(), { prefs: { seen: { her: T0 } } });
  ok('более старая метка не откатывает новую', (await doc('me')).prefs.seen.her === T1);
  await run('POST', ME(), { prefs: { seen: { me: '2026-09-21T09:00:00Z' } } });
  ok('метки двух профилей хранятся вместе', Object.keys((await doc('me')).prefs.seen).sort().join() === 'her,me');
  process.exit(0);
})();
