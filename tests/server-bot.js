// tests/server-bot.js — тест api/bot.js: webhook, авторизация, команды бота
process.env.BOT_TOKEN = '123456:TESTBOTTOKEN';
process.env.ME_TG_ID = '111';
process.env.HER_TG_ID = '222';
process.env.KV_REST_API_URL = 'https://redis.test';
process.env.KV_REST_API_TOKEN = 'tok';

const makeKV = require('./kvmock.js');
const kv = makeKV();

const L = (id, date, s, e, subject, extra = {}) => Object.assign({
  id, date, start: s, end: e, startAt: date + 'T' + s + ':00', endAt: date + 'T' + e + ':00',
  num: 1, kind: 'лек', subject, teacher: 'Т', room: '1',
}, extra);

const telegramCalls = [];
let scheduleMock = {
  me: { lessons: [L(1, '2026-09-21', '09:40', '11:10', 'Конструкция')], errors: [] },
  her: { lessons: [L(2, '2026-09-21', '08:30', '10:05', 'Инклюзия')], errors: [] },
};

global.fetch = async (url, opts = {}) => {
  const j = (status, body) => ({ ok: status < 400, status, json: async () => body });
  if (url.startsWith('https://api.telegram.org/bot')) {
    telegramCalls.push({ url, body: opts.body ? JSON.parse(opts.body) : null });
    return j(200, { ok: true, result: true });
  }
  if (url.startsWith('https://parket-2.vercel.app/api/schedule?profile=me')) {
    return j(200, scheduleMock.me);
  }
  if (url.startsWith('https://parket-2.vercel.app/api/schedule?profile=her')) {
    return j(200, scheduleMock.her);
  }
  if (url === 'https://redis.test') {
    return j(200, { result: kv.exec(JSON.parse(opts.body)) });
  }
  return j(404, {});
};

const handler = require('../api/bot.js');
const { botSecretToken } = handler.__internals;
const VALID_SECRET = botSecretToken(process.env.BOT_TOKEN);

const run = (method, url, body, customHeaders = {}) => new Promise((resolve) => {
  const req = {
    method,
    url,
    headers: {
      host: 'parket-2.vercel.app',
      'x-telegram-bot-api-secret-token': VALID_SECRET,
      ...customHeaders,
    },
    body,
  };
  const res = {
    setHeader() {},
    status(c) { this.code = c; return this; },
    json(b) { resolve({ code: this.code, body: b }); },
  };
  handler(req, res);
});

const ok = (name, cond, info) => console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (cond ? '' : '   ' + JSON.stringify(info)));

(async () => {
  // 1. GET статус
  const st = await run('GET', '/api/bot');
  ok('GET /api/bot: 200 ok', st.code === 200 && st.body.status === 'ok');

  // 2. GET ?setup=1
  telegramCalls.length = 0;
  const setup = await run('GET', '/api/bot?setup=1');
  ok('GET /api/bot?setup=1 вызывает setWebhook и setMyCommands', setup.code === 200 && telegramCalls.length === 2 && telegramCalls[0].url.includes('setWebhook') && telegramCalls[1].url.includes('setMyCommands'));
  ok('GET /api/bot?setup=1 регистрирует secret_token в Telegram', telegramCalls[0].url.includes('secret_token=' + VALID_SECRET));

  // 2.1. Защита webhook от поддельных запросов
  const noSecret = await run('POST', '/api/bot', { message: { chat: { id: 111 }, text: '/start' } }, { 'x-telegram-bot-api-secret-token': '' });
  ok('webhook без secret token: 401 unauthorized', noSecret.code === 401 && noSecret.body.error === 'unauthorized');

  const badSecret = await run('POST', '/api/bot', { message: { chat: { id: 111 }, text: '/start' } }, { 'x-telegram-bot-api-secret-token': 'wrong-token' });
  ok('webhook с чужим secret token: 401 unauthorized', badSecret.code === 401 && badSecret.body.error === 'unauthorized');

  // 3. Чужой пользователь
  telegramCalls.length = 0;
  const anon = await run('POST', '/api/bot', { message: { chat: { id: 999999 }, text: '/start' } });
  ok('чужой пользователь: вежливый отказ', anon.code === 200 && telegramCalls.length === 1 && telegramCalls[0].body.text.includes('только владельцам'));

  // 4. /start для Кирилла (111)
  telegramCalls.length = 0;
  const startMe = await run('POST', '/api/bot', { message: { chat: { id: 111 }, text: '/start' } });
  ok('/start для Кирилла: приветствие и клавиатура', startMe.code === 200 && telegramCalls[0].body.text.includes('Привет, Кирилл') && !!telegramCalls[0].body.reply_markup.keyboard);

  // Добавим данные в kv для тестов
  kv.exec(['SET', 'parket:v1:doc:me', JSON.stringify({
    hw: { 'общая психология': { name: 'Общая психология', text: 'Конспект параграфа 3', done: false } },
    custom: { c1: { title: 'Поход в кино', kind: '', date: '2026-10-05', start: '19:00', end: '21:00', both: true } },
    done: {}, colors: {}, prefs: {}
  })]);
  kv.exec(['SET', 'parket:v1:doc:her', JSON.stringify({ hw: {}, custom: {}, done: {}, colors: {}, prefs: {} })]);

  // 5. /today
  telegramCalls.length = 0;
  await run('POST', '/api/bot', { message: { chat: { id: 111 }, text: '/today' } });
  ok('/today: ответ с расписанием', telegramCalls.length === 1 && telegramCalls[0].body.text.includes('Твоё расписание'));

  // 6. /free
  telegramCalls.length = 0;
  await run('POST', '/api/bot', { message: { chat: { id: 111 }, text: '/free' } });
  ok('/free: свободны вместе', telegramCalls.length === 1 && telegramCalls[0].body.text.includes('Свободны вместе'));

  // 7. /hw
  telegramCalls.length = 0;
  await run('POST', '/api/bot', { message: { chat: { id: 111 }, text: '/hw' } });
  ok('/hw: список ДЗ', telegramCalls.length === 1 && telegramCalls[0].body.text.includes('Конспект параграфа 3'));

  // 8. /together
  telegramCalls.length = 0;
  await run('POST', '/api/bot', { message: { chat: { id: 222 }, text: '/together' } });
  ok('/together для Маши: видит совместное кино', telegramCalls.length === 1 && telegramCalls[0].body.text.includes('Поход в кино'));

  // 9. /tomorrow
  telegramCalls.length = 0;
  await run('POST', '/api/bot', { message: { chat: { id: 111 }, text: '/tomorrow' } });
  ok('/tomorrow: дайджест на завтра', telegramCalls.length === 1 && telegramCalls[0].body.text.includes('Твои пары'));

  // 10. Частичное расписание (schedule.errors.length > 0) считается недоступным
  // 10.1. Для me (Кирилл)
  scheduleMock.me = { lessons: [L(1, '2026-09-21', '09:40', '11:10', 'Конструкция')], errors: [{ week: 1, error: 'timeout' }] };
  telegramCalls.length = 0;
  await run('POST', '/api/bot', { message: { chat: { id: 111 }, text: '/today' } });
  ok('partial schedule для me: /today сообщает, что расписание недоступно', telegramCalls[0].body.text.includes('<b>Твоё расписание:</b>\nРасписание пока недоступно.'));
  ok('при partial schedule у себя блок общих окон не выводится', !telegramCalls[0].body.text.includes('Свободны вместе сегодня'));

  telegramCalls.length = 0;
  await run('POST', '/api/bot', { message: { chat: { id: 111 }, text: '/free' } });
  ok('partial schedule: /free сообщает, что расписание недоступно для расчёта', telegramCalls[0].body.text.includes('временно недоступно для расчёта'));

  telegramCalls.length = 0;
  await run('POST', '/api/bot', { message: { chat: { id: 111 }, text: '/tomorrow' } });
  ok('partial schedule: /tomorrow сообщает Расписание пока недоступно вместо Пар нет', telegramCalls[0].body.text.includes('<b>Твои пары</b>\nРасписание пока недоступно.'));

  // 10.2. Для her (Маша)
  scheduleMock.me = { lessons: [L(1, '2026-09-21', '09:40', '11:10', 'Конструкция')], errors: [] };
  scheduleMock.her = { lessons: [L(2, '2026-09-21', '08:30', '10:05', 'Инклюзия')], errors: [{ week: 2, error: 'failed' }] };
  telegramCalls.length = 0;
  await run('POST', '/api/bot', { message: { chat: { id: 111 }, text: '/today' } });
  ok('partial schedule для her: у партнёра указано Расписание пока недоступно', telegramCalls[0].body.text.includes('<b>Маша:</b>\nРасписание пока недоступно.'));
  ok('при partial schedule у партнёра блок общих окон в /today не выводится', !telegramCalls[0].body.text.includes('Свободны вместе сегодня'));

  telegramCalls.length = 0;
  await run('POST', '/api/bot', { message: { chat: { id: 111 }, text: '/free' } });
  ok('partial schedule у партнёра: /free также сообщает о недоступности', telegramCalls[0].body.text.includes('временно недоступно для расчёта'));

  process.exit(0);
})();
