// lib/shared.js — общее для api/state.js и api/notify.js:
// проверка подписи Telegram, доступ к Redis (REST), белый список id.
// Переменные читаются при вызове, а не при загрузке модуля.

const crypto = require('crypto');

const MAX_AGE_SEC = 2 * 24 * 3600;      // initData считаем свежей двое суток
const REDIS_TIMEOUT_MS = 8000;
const SCHEDULE_TIMEOUT_MS = 9000;       // запрос к своему же /api/schedule (notify.js, lib/detect.js)

function cfg() {
  const owners = {};
  if (process.env.ME_TG_ID) owners[String(process.env.ME_TG_ID).trim()] = 'me';
  if (process.env.HER_TG_ID) owners[String(process.env.HER_TG_ID).trim()] = 'her';
  return {
    botToken: process.env.BOT_TOKEN,
    redisUrl: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
    redisToken: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN,
    owners,
    tgId: { me: process.env.ME_TG_ID ? String(process.env.ME_TG_ID).trim() : null, her: process.env.HER_TG_ID ? String(process.env.HER_TG_ID).trim() : null },
  };
}

// ---------- проверка подписи Telegram ----------
function verifyInitData(initData, botToken) {
  if (!initData || !botToken) return null;
  const p = new URLSearchParams(initData);
  const hash = p.get('hash');
  if (!hash) return null;
  p.delete('hash');
  const check = [...p.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calc = crypto.createHmac('sha256', secret).update(check).digest('hex');
  const a = Buffer.from(calc);
  const b = Buffer.from(hash);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const age = Date.now() / 1000 - Number(p.get('auth_date') || 0);
  if (!(age >= -60 && age <= MAX_AGE_SEC)) return null;
  try { return JSON.parse(p.get('user') || 'null'); } catch (e) { return null; }
}

// ---------- Redis (REST) ----------
async function redis(cmd) {
  const c = cfg();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REDIS_TIMEOUT_MS);
  let r;
  try {
    r = await fetch(c.redisUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${c.redisToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(cmd),
      signal: ctrl.signal,
    });
  } catch (e) {
    throw new Error(e && e.name === 'AbortError' ? 'redis timeout' : 'redis network: ' + ((e && e.message) || e));
  } finally {
    clearTimeout(timer);
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || 'redis HTTP ' + r.status);
  return j.result;
}

// Расписание своего же /api/schedule — общий помощник для notify.js (текст напоминания) и
// lib/detect.js (сравнение версий), чтобы оба не держали свою копию таймаута и обработки ошибок.
async function fetchSchedule(base, profile) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SCHEDULE_TIMEOUT_MS);
  try {
    const r = await fetch(`${base}/api/schedule?profile=${profile}`, { signal: ctrl.signal });
    if (!r.ok) { console.error('fetchSchedule: HTTP', r.status, profile, base); return null; }
    const j = await r.json();
    return Array.isArray(j.lessons) ? j : null;
  } catch (e) {
    console.error('fetchSchedule: ошибка', profile, base, String((e && e.message) || e));
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const docKey = (who) => 'parket:v1:doc:' + who;
const emptyDoc = () => ({ hw: {}, done: {}, colors: {}, custom: {}, prefs: {} });

async function getDoc(who) {
  const raw = await redis(['GET', docKey(who)]);
  if (!raw) return emptyDoc();
  try {
    const d = JSON.parse(raw);
    return { hw: d.hw || {}, done: d.done || {}, colors: d.colors || {}, custom: d.custom || {}, prefs: d.prefs || {} };
  } catch (e) { return emptyDoc(); }
}

// timing-safe сравнение строк (для секрета cron)
function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Адрес приложения (для запросов к своему же /api/schedule и для кнопки в сообщении).
// Порядок: APP_URL -> боевой домен проекта (Vercel сам подставляет VERCEL_PROJECT_PRODUCTION_URL) -> хост запроса.
// Хост запроса надёжен только для запросов из приложения: cron может прийти на адрес конкретной сборки,
// а он закрыт логином Vercel.
function appBase(req) {
  if (process.env.APP_URL) return String(process.env.APP_URL).replace(/\/+$/, '');
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return 'https://' + process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const h = req && req.headers ? req.headers : {};
  return 'https://' + (h['x-forwarded-host'] || h.host);
}

module.exports = { cfg, verifyInitData, redis, docKey, emptyDoc, getDoc, safeEqual, appBase, fetchSchedule };
