// api/state.js — общее хранилище ДЗ и отметок «пройдена» для двоих.
//
// GET  /api/state -> { who: 'me'|'her', docs: { me, her } }   (читать могут оба)
// POST /api/state -> тело { hw: {ключ: {name,text,done}|null}, done: {ключ: true|null}, colors: {ключ: 0..15|null},
//                         custom: {id: {title,kind,date,start,end,room,teacher,until?,skip?}|null},
//                         prefs: {notify: true|false} }
//                    пишется ТОЛЬКО в документ того, кто прислал запрос
//
// Доступ: Telegram initData (подпись проверяется токеном бота) + белый список id.
// Переменные окружения на Vercel:
//   BOT_TOKEN   — токен бота из @BotFather (секрет, только сюда)
//   ME_TG_ID    — Telegram id Кирилла
//   HER_TG_ID   — Telegram id Маши
//   Upstash Redis: UPSTASH_REDIS_REST_URL / _TOKEN  или  KV_REST_API_URL / _TOKEN (ставятся сами при подключении базы)

const { cfg, verifyInitData, redis, docKey, getDoc } = require('../lib/shared');

const HW_MAX = 100;                // длина ДЗ
const NAME_MAX = 120;
const KEY_MAX = 160;
const MAX_ENTRIES = 2000;
const PALETTE_SIZE = 16;           // цветовых меток предметов
const MAX_CUSTOM = 300;            // своих пар (серий) на человека
const KINDS = new Set(['', 'лек', 'пр', 'лаб']);
const ID_RE = /^[a-z0-9_-]{1,40}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// ---------- своя пара: проверка и очистка ----------
function validDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
function cleanCustom(v, now) {
  if (!v || typeof v !== 'object') return null;
  const title = String(v.title || '').trim().slice(0, 80);
  if (!title) return null;
  const kind = KINDS.has(v.kind) ? v.kind : '';
  if (!validDate(v.date) || !TIME_RE.test(v.start || '') || !TIME_RE.test(v.end || '') || v.end <= v.start) return null;
  const out = {
    title, kind, date: v.date, start: v.start, end: v.end,
    room: String(v.room || '').trim().slice(0, 40),
    teacher: String(v.teacher || '').trim().slice(0, 60),
    t: now,
  };
  if (v.until) {
    if (!validDate(v.until) || v.until < v.date) return null;
    if ((Date.parse(v.until) - Date.parse(v.date)) / 864e5 > 400) return null;
    out.until = v.until;
  }
  if (Array.isArray(v.skip)) {                              // пропущенные даты серии
    const sk = v.skip.filter(validDate).slice(0, 80);
    if (sk.length) out.skip = sk;
  }
  return out;
}

// ---------- применение патча ----------
function applyPatch(doc, patch, now) {
  const hw = (patch && typeof patch.hw === 'object' && patch.hw) || {};
  const done = (patch && typeof patch.done === 'object' && patch.done) || {};
  const colors = (patch && typeof patch.colors === 'object' && patch.colors) || {};
  const custom = (patch && typeof patch.custom === 'object' && patch.custom) || {};
  const prefs = (patch && typeof patch.prefs === 'object' && patch.prefs) || {};
  if (!doc.colors) doc.colors = {};
  if (!doc.custom) doc.custom = {};
  if (!doc.prefs) doc.prefs = {};
  if (typeof prefs.notify === 'boolean') doc.prefs.notify = prefs.notify;
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
  for (const [k, v] of Object.entries(colors)) {
    if (k.length > KEY_MAX || BAD_KEYS.has(k)) continue;
    if (Number.isInteger(v) && v >= 0 && v < PALETTE_SIZE) doc.colors[k] = v; else delete doc.colors[k];
  }
  for (const [id, v] of Object.entries(custom)) {
    if (!ID_RE.test(id) || BAD_KEYS.has(id)) continue;
    if (v === null) { delete doc.custom[id]; continue; }
    const c = cleanCustom(v, now);
    if (!c) continue;                                       // некорректное молча пропускаем
    if (!doc.custom[id] && Object.keys(doc.custom).length >= MAX_CUSTOM) continue;
    doc.custom[id] = c;
  }
  const ckeys = Object.keys(doc.colors);
  if (ckeys.length > MAX_ENTRIES) ckeys.slice(0, ckeys.length - MAX_ENTRIES).forEach((k) => delete doc.colors[k]);
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

  const c = cfg();
  const missing = [];
  if (!c.botToken) missing.push('BOT_TOKEN');
  if (!c.redisUrl || !c.redisToken) missing.push('Upstash Redis');
  if (missing.length) return res.status(503).json({ error: 'not_configured', missing });

  const user = verifyInitData(String(req.headers['x-init-data'] || ''), c.botToken);
  if (!user) return res.status(401).json({ error: 'unauthorized' });
  const who = c.owners[String(user.id)];
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
