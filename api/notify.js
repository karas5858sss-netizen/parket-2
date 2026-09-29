// api/notify.js — вечернее напоминание в Telegram.
//
// GET  /api/notify  — вызывает Vercel Cron (Authorization: Bearer <CRON_SECRET>), шлёт обоим.
// POST /api/notify  — «прислать пример сейчас»: только тому, кто нажал (проверка подписи Telegram).
//
// Переменные окружения: BOT_TOKEN, ME_TG_ID, HER_TG_ID, CRON_SECRET, база Upstash (см. state.js).
// Необязательная: APP_URL — адрес приложения для кнопки «Открыть расписание»
// (по умолчанию берётся из заголовка запроса, то есть боевой домен).

const { cfg, verifyInitData, getDoc, safeEqual, appBase, fetchSchedule, getLastNotified, setLastNotified, sendTelegram, redis } = require('../lib/shared');
const { buildDigest, mskNow, addDays, mergeLessons } = require('../lib/digest');
const { refreshChanges } = require('../lib/detect');
const { LOG_MAX_AGE_DAYS } = require('../lib/changes');
const { pairNo, toMin } = require('../lib/slots');

// Окно раньше было 30 часов («со вчерашнего вечера»), но если cron пропустит день (сбой Vercel,
// не настроен CRON_SECRET и т.п.), непрочитанные изменения за это время молча выпадали бы из
// сообщения, хотя ещё лежат в журнале. Отметка «прочитано» (seen) и так не даёт слать повторно —
// поэтому окно теперь равно сроку жизни самого журнала (lib/changes.js), а не отдельному числу.
const CHANGES_WINDOW_MS = LOG_MAX_AGE_DAYS * 24 * 3600 * 1000;

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const c = cfg();

  const missing = [];
  if (!c.botToken) missing.push('BOT_TOKEN');
  if (!c.redisUrl || !c.redisToken) missing.push('Upstash Redis');
  if (req.method === 'GET' && !process.env.CRON_SECRET) missing.push('CRON_SECRET');
  if (missing.length) {
    console.error('notify: не настроено, напоминание не отправлено. Не хватает:', missing.join(', '));
    return res.status(503).json({ error: 'not_configured', missing });
  }

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

  const base = appBase(req);
  const now = mskNow();
  const date = addDays(now.slice(0, 10), 1);

  // Расписание запрашиваем один раз на профиль и переиспользуем: и для текста напоминания,
  // и для сравнения версий (передаём его в refreshChanges вместо того, чтобы она грузила его сама).
  let scheduleFull;
  let docs;
  let lastNotified;
  try {
    const [sMe, sHer, dMe, dHer, nMe, nHer] = await Promise.all([
      fetchSchedule(base, 'me'), fetchSchedule(base, 'her'), getDoc('me'), getDoc('her'),
      getLastNotified('me'), getLastNotified('her'),
    ]);
    scheduleFull = { me: sMe, her: sHer };
    docs = { me: dMe, her: dHer };
    lastNotified = { me: nMe, her: nHer };
  } catch (e) {
    return res.status(502).json({ error: 'storage_failed', message: String((e && e.message) || e) });
  }
  // Частично загруженное расписание (часть недель не ответила — есть errors) не идёт в текст
  // напоминания: лучше промолчать про профиль, чем сказать неправду («пар нет» или неполный
  // список пар только потому, что кусок расписания не успел прийти). Обнаружение изменений уже
  // отдельно пропускает такие случаи в lib/detect.js — здесь та же осторожность нужна для digest.
  const usable = (s) => !!(s && Array.isArray(s.lessons) && (!s.errors || !s.errors.length));
  const schedules = { me: usable(scheduleFull.me) ? scheduleFull.me.lessons : null, her: usable(scheduleFull.her) ? scheduleFull.her.lessons : null };

  const u = new URL(req.url, 'http://localhost');
  const isUpcoming = u.searchParams.get('type') === 'upcoming' || u.searchParams.get('upcoming') === '1';
  if (isUpcoming) {
    const today = now.slice(0, 10);
    const nowMin = toMin(now.slice(11, 16));
    const results = [];
    const escHtml = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));
    for (const who of targets) {
      if (!manual && docs[who].prefs && docs[who].prefs.notify === false) { results.push({ who, skipped: 'disabled' }); continue; }
      const other = who === 'me' ? 'her' : 'me';
      const all = mergeLessons(schedules[who], docs[who], docs[other]);
      const upcoming = all.filter((l) => {
        if (l.date !== today) return false;
        const diff = toMin(l.start) - nowMin;
        return diff >= 45 && diff <= 75; // за 45..75 минут до начала (примерно за 1 час)
      });
      const chatId = c.tgId[who];
      if (!chatId) { results.push({ who, error: 'no_telegram_id' }); continue; }
      for (const l of upcoming) {
        const dedupeKey = `parket:v1:notified_1h:${who}:${l.date}:${l.start}:${l.subject}`;
        const already = await redis(['GET', dedupeKey]).catch(() => null);
        if (already) continue;
        const room = l.room ? ', ауд. ' + (l.room.includes(' - ') ? l.room.split(' - ')[0] : l.room) : '';
        const pn = pairNo(who, l);
        const text = l.both
          ? `❤️ <b>Через 1 час:</b> ${l.start}–${l.end} «${escHtml(l.subject)}»${room ? ` (${escHtml(room.slice(2))})` : ''} [вместе 👫]`
          : `🔔 <b>Через 1 час пара:</b> ${pn ? pn + ' пара, ' : ''}${l.start}–${l.end} «${escHtml(l.subject)}»${escHtml(room)}`;
        try {
          await sendTelegram(c.botToken, chatId, text, base);
          await redis(['SET', dedupeKey, '1', 'EX', 86400]).catch(() => {});
          results.push({ who, lesson: l.subject, sent: true });
        } catch (e) {
          results.push({ who, lesson: l.subject, error: String((e && e.message) || e) });
        }
      }
    }
    return res.status(200).json({ ok: true, type: 'upcoming', results, cronReady: !!process.env.CRON_SECRET });
  }

  // журнал изменений: расписание уже загружено выше, сверяем на его основе, потом берём непрочитанное
  let logs = { me: [], her: [] };
  try {
    logs = (await refreshChanges({ base, today: now.slice(0, 10), nowIso: new Date(Date.now()).toISOString(), schedules: scheduleFull })).items;
  } catch (e) { /* без изменений письмо всё равно уйдёт */ }
  const since = new Date(Date.now() - CHANGES_WINDOW_MS).toISOString();
  // Не повторяем то, что уже увидели В ПРИЛОЖЕНИИ (prefs.seen), и не повторяем то, что уже
  // ОТПРАВИЛИ раньше через Telegram (lastNotified) — какая из двух отметок новее, та и действует.
  const changesFor = (who) => {
    const seen = (docs[who].prefs && docs[who].prefs.seen && docs[who].prefs.seen[who]) || '';
    const cutoff = seen > lastNotified[who] ? seen : lastNotified[who];
    return (logs[who] || []).filter((e) => e.t > cutoff && e.t >= since && (e.type === 'published' || !e.date || e.date >= now.slice(0, 10)));
  };

  const results = [];
  for (const who of targets) {
    if (!manual && docs[who].prefs && docs[who].prefs.notify === false) { results.push({ who, skipped: 'disabled' }); continue; }
    if (!schedules[who]) {
      // Различаем причину для логов: расписание вообще не пришло — или пришло, но частично.
      results.push({ who, error: scheduleFull[who] ? 'schedule_partial' : 'schedule_unavailable' });
      continue;
    }
    const chatId = c.tgId[who];
    if (!chatId) { results.push({ who, error: 'no_telegram_id' }); continue; }
    const changes = changesFor(who);
    try {
      await sendTelegram(c.botToken, chatId, buildDigest({ who, date, now, schedules, docs, changes }), base);
      results.push({ who, sent: true });
      // Отметку двигаем только сюда — после ПОДТВЕРЖДЁННОЙ отправки, и только если правда что-то
      // рассказали: неудачная попытка или пустой список изменений не должны сдвигать отметку.
      if (changes.length) {
        const maxT = changes.reduce((m, e) => (e.t > m ? e.t : m), '');
        try { await setLastNotified(who, maxT); } catch (e) { console.error('notify: не удалось сохранить lastNotified', who, String((e && e.message) || e)); }
      }
    } catch (e) {
      results.push({ who, error: String((e && e.message) || e) });
    }
  }

  console.log('notify', JSON.stringify({ manual, date, base, results }));   // видно в Vercel → Logs
  const failed = results.filter((r) => r.error);
  if (manual && failed.length) return res.status(502).json({ ok: false, error: failed[0].error, results });
  // cronReady: задан ли CRON_SECRET. Без него вечерний запуск от Vercel Cron получает отказ, хотя «пример» из приложения работает.
  return res.status(200).json({ ok: true, date, base, results, cronReady: !!process.env.CRON_SECRET });
};
