// api/state.js — общее хранилище ДЗ и отметок «пройдена» для двоих.
//
// GET  /api/state -> { who: 'me'|'her', docs: { me, her } }   (читать могут оба)
// POST /api/state -> тело { hw: {ключ: {name,text,done}|null}, done: {ключ: true|null} }
//                    пишется ТОЛЬКО в документ того, кто прислал запрос
//
// Доступ: Telegram initData (подпись проверяется токеном бота) + белый список id.
// Переменные окружения на Vercel:
//   BOT_TOKEN   — токен бота из @BotFather (секрет, только сюда)
//   ME_TG_ID    — Telegram id Кирилла
//   HER_TG_ID   — Telegram id Маши
//   Upstash Redis: UPSTASH_REDIS_REST_URL / _TOKEN  или  KV_REST_API_URL / _TOKEN (ставятся сами при подключении базы)

const crypto = require('crypto');

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const BOT_TOKEN = process.env.BOT_TOKEN;

const OWNERS = {};
if (process.env.ME_TG_ID) OWNERS[String(process.env.ME_TG_ID).trim()] = 'me';
if (process.env.HER_TG_ID) OWNERS[String(process.env.HER_TG_ID).trim()] = 'her';

const MAX_AGE_SEC = 2 * 24 * 3600; // initData считаем свежей двое суток
const HW_MAX = 100;                // длина ДЗ
const NAME_MAX = 120;
const KEY_MAX = 160;
const MAX_ENTRIES = 2000;
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const emptyDoc = () => ({ hw: {}, done: {} });

// ---------- проверка подписи Telegram ----------
function verifyInitData(initData, botToken) {
  if (!initData) return null;
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
  const r = await fetch(REDIS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || 'redis HTTP ' + r.status);
  return j.result;
}
const docKey = (who) => 'parket:v1:doc:' + who;
async function getDoc(who) {
  const raw = await redis(['GET', docKey(who)]);
  if (!raw) return emptyDoc();
  try {
    const d = JSON.parse(raw);
    return { hw: d.hw || {}, done: d.done || {} };
  } catch (e) { return emptyDoc(); }
}

// ---------- применение патча ----------
function applyPatch(doc, patch, now) {
  const hw = (patch && typeof patch.hw === 'object' && patch.hw) || {};
  const done = (patch && typeof patch.done === 'object' && patch.done) || {};
  for (const [k, v] of Object.entries(hw)) {
    if (k.length > KEY_MAX || BAD_KEYS.has(k)) continue;
    if (v === null || typeof v !== 'object') { delete doc.hw[k]; continue; }
    const text = String(v.text || '').trim().slice(0, HW_MAX);
    if (!text) { delete doc.hw[k]; continue; }
    doc.hw[k] = { name: String(v.name || '').slice(0, NAME_MAX), text, done: !!v.done, t: now };
  }
  for (const [k, v] of Object.entries(done)) {
    if (k.length > KEY_MAX || BAD_KEYS.has(k)) continue;
    if (v) doc.done[k] = now; else delete doc.done[k];
  }
  const keys = Object.keys(doc.done);
  if (keys.length > MAX_ENTRIES) {
    keys.sort((a, b) => doc.done[a] - doc.done[b]).slice(0, keys.length - MAX_ENTRIES).forEach((k) => delete doc.done[k]);
  }
  const hkeys = Object.keys(doc.hw);
  if (hkeys.length > MAX_ENTRIES) {
    hkeys.sort((a, b) => doc.hw[a].t - doc.hw[b].t).slice(0, hkeys.length - MAX_ENTRIES).forEach((k) => delete doc.hw[k]);
  }
}

function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch (e) { return {}; }
}

// ---------- handler ----------
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  const missing = [];
  if (!BOT_TOKEN) missing.push('BOT_TOKEN');
  if (!REDIS_URL || !REDIS_TOKEN) missing.push('Upstash Redis');
  if (missing.length) return res.status(503).json({ error: 'not_configured', missing });

  const user = verifyInitData(String(req.headers['x-init-data'] || ''), BOT_TOKEN);
  if (!user) return res.status(401).json({ error: 'unauthorized' });
  const who = OWNERS[String(user.id)];
  if (!who) return res.status(403).json({ error: 'not_allowed', yourId: user.id });

  try {
    if (req.method === 'GET') {
      const [me, her] = await Promise.all([getDoc('me'), getDoc('her')]);
      return res.status(200).json({ who, docs: { me, her } });
    }
    if (req.method === 'POST') {
      const doc = await getDoc(who);
      applyPatch(doc, parseBody(req), Date.now());
      await redis(['SET', docKey(who), JSON.stringify(doc)]);
      return res.status(200).json({ ok: true });
    }
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (e) {
    return res.status(502).json({ error: 'storage_failed', message: String((e && e.message) || e) });
  }
};
