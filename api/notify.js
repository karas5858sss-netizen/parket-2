// api/notify.js — вечернее напоминание в Telegram.
//
// GET  /api/notify  — вызывает Vercel Cron (Authorization: Bearer <CRON_SECRET>), шлёт обоим.
// POST /api/notify  — «прислать пример сейчас»: только тому, кто нажал (проверка подписи Telegram).
//
// Переменные окружения: BOT_TOKEN, ME_TG_ID, HER_TG_ID, CRON_SECRET, база Upstash (см. state.js).
// Необязательная: APP_URL — адрес приложения для кнопки «Открыть расписание»
// (по умолчанию берётся из заголовка запроса, то есть боевой домен).

const { cfg, verifyInitData, getDoc, safeEqual } = require('../lib/shared');
const { buildDigest, mskNow, addDays } = require('../lib/digest');
const { refreshChanges } = require('../lib/detect');

const CHANGES_WINDOW_MS = 30 * 3600 * 1000; // в сообщение попадает то, что найдено после прошлого вечернего

const FETCH_TIMEOUT_MS = 9000;

async function fetchSchedule(base, profile) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(`${base}/api/schedule?profile=${profile}`, { signal: ctrl.signal });
    if (!r.ok) return null;
    const j = await r.json();
    return Array.isArray(j.lessons) ? j.lessons : null;
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function sendTelegram(token, chatId, text, appUrl) {
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: [[{ text: 'Открыть расписание', web_app: { url: appUrl } }]] },
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(j.description || 'telegram HTTP ' + r.status);
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const c = cfg();

  const missing = [];
  if (!c.botToken) missing.push('BOT_TOKEN');
  if (!c.redisUrl || !c.redisToken) missing.push('Upstash Redis');
  if (req.method === 'GET' && !process.env.CRON_SECRET) missing.push('CRON_SECRET');
  if (missing.length) return res.status(503).json({ error: 'not_configured', missing });

  let targets;
  let manual = false;
  if (req.method === 'POST') {
    const user = verifyInitData(String(req.headers['x-init-data'] || ''), c.botToken);
    if (!user) return res.status(401).json({ error: 'unauthorized' });
    const who = c.owners[String(user.id)];
    if (!who) return res.status(403).json({ error: 'not_allowed', yourId: user.id });
    targets = [who];
    manual = true;
  } else if (req.method === 'GET') {
    if (!safeEqual(String(req.headers.authorization || ''), 'Bearer ' + process.env.CRON_SECRET)) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    targets = ['me', 'her'];
  } else {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const base = process.env.APP_URL || `https://${req.headers['x-forwarded-host'] || req.headers.host}`;
  const now = mskNow();
  const date = addDays(now.slice(0, 10), 1);

  let schedules;
  let docs;
  try {
    const [sMe, sHer, dMe, dHer] = await Promise.all([
      fetchSchedule(base, 'me'), fetchSchedule(base, 'her'), getDoc('me'), getDoc('her'),
    ]);
    schedules = { me: sMe, her: sHer };
    docs = { me: dMe, her: dHer };
  } catch (e) {
    return res.status(502).json({ error: 'storage_failed', message: String((e && e.message) || e) });
  }

  // журнал изменений: сначала сверяем расписание, потом берём непрочитанные свежие записи
  let logs = { me: [], her: [] };
  try {
    logs = (await refreshChanges({ base, today: now.slice(0, 10), nowIso: new Date(Date.now()).toISOString() })).items;
  } catch (e) { /* без изменений письмо всё равно уйдёт */ }
  const since = new Date(Date.now() - CHANGES_WINDOW_MS).toISOString();
  const changesFor = (who) => {
    const seen = (docs[who].prefs && docs[who].prefs.seen && docs[who].prefs.seen[who]) || '';
    return (logs[who] || []).filter((e) => e.t > seen && e.t >= since && (e.type === 'published' || !e.date || e.date >= now.slice(0, 10)));
  };

  const results = [];
  for (const who of targets) {
    if (!manual && docs[who].prefs && docs[who].prefs.notify === false) { results.push({ who, skipped: 'disabled' }); continue; }
    if (!schedules[who]) { results.push({ who, error: 'schedule_unavailable' }); continue; }
    const chatId = c.tgId[who];
    if (!chatId) { results.push({ who, error: 'no_telegram_id' }); continue; }
    try {
      await sendTelegram(c.botToken, chatId, buildDigest({ who, date, now, schedules, docs, changes: changesFor(who) }), base);
      results.push({ who, sent: true });
    } catch (e) {
      results.push({ who, error: String((e && e.message) || e) });
    }
  }

  const failed = results.filter((r) => r.error);
  if (manual && failed.length) return res.status(502).json({ ok: false, error: failed[0].error, results });
  return res.status(200).json({ ok: true, date, results });
};
