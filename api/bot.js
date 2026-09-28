// api/bot.js — Telegram-бот «ПАР·КЕТ» для Кирилла и Маши.
//
// GET  /api/bot?setup=1 — регистрирует webhook и кнопки команд в Telegram Bot API.
// POST /api/bot         — обработчик сообщений от Telegram Webhook.
//
// Команды:
//   /today      — расписание на сегодня (твоё, партнёра и свободные окна)
//   /tomorrow   — расписание и дайджест на завтра
//   /free       — когда свободны вместе (сегодня и завтра)
//   /hw         — активные домашние задания
//   /together   — совместные дела и мероприятия
//   /start, /help — меню и кнопка запуска WebApp

const { cfg, appBase, getDoc, fetchSchedule } = require('../lib/shared');
const { mskNow, addDays, mergeLessons, buildDigest, NAMES } = require('../lib/digest');
const { pairNo, jointWindows, fmtMin, dur, toMin } = require('../lib/slots');
const PEOPLE = require('../config/profiles.js');

const TELEGRAM_TIMEOUT_MS = 8000;
const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const dOf = (s) => new Date(s + 'T00:00:00Z');
const humanDate = (s) => { const d = dOf(s); return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()]; };

async function sendTelegramMessage(token, chatId, text, replyMarkup) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TELEGRAM_TIMEOUT_MS);
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup: replyMarkup,
      }),
      signal: ctrl.signal,
    });
    return await res.json().catch(() => ({}));
  } finally {
    clearTimeout(timer);
  }
}

function getMainKeyboard(appUrl) {
  return {
    keyboard: [
      [{ text: '📅 Сегодня' }, { text: '🌅 Завтра' }],
      [{ text: '👫 Свободны вместе' }, { text: '📝 ДЗ' }],
      [{ text: '❤️ Совместные дела' }, { text: '📱 Открыть ПАР·КЕТ', web_app: { url: appUrl } }],
    ],
    resize_keyboard: true,
  };
}

function formatLesson(l, profile) {
  const room = l.room ? ', ауд. ' + (l.room.includes(' - ') ? l.room.split(' - ')[0] : l.room) : '';
  const no = pairNo(profile, l);
  const tag = l.both ? ' <b>[вместе 👫]</b>' : '';
  return `${no ? no + ' пара: ' : ''}<b>${esc(l.start)}–${esc(l.end)}</b> ${esc(l.subject)}${tag}${l.kind ? ' (' + esc(l.kind) + ')' : ''}${esc(room)}`;
}

function handleStart(who, appUrl) {
  const name = NAMES[who] || (who === 'me' ? 'Кирилл' : 'Маша');
  return `👋 <b>Привет, ${esc(name)}!</b>\n\n` +
    `Я бот <b>«ПАР·КЕТ»</b> — синхронизирую ваше расписание, совместные дела, свободные окна и ДЗ.\n\n` +
    `<b>Что я умею:</b>\n` +
    `• <b>📅 Сегодня</b> (/today) — расписание на сегодня и кто где сейчас\n` +
    `• <b>🌅 Завтра</b> (/tomorrow) — расписание и дайджест на завтра\n` +
    `• <b>👫 Свободны вместе</b> (/free) — свободные окна от 1 часа\n` +
    `• <b>📝 ДЗ</b> (/hw) — список активных домашних заданий\n` +
    `• <b>❤️ Совместные дела</b> (/together) — ваши общие планы и мероприятия\n\n` +
    `Или нажми кнопку ниже, чтобы открыть полное приложение!`;
}

function handleToday({ who, today, now, mine, theirs }) {
  const other = who === 'me' ? 'her' : 'me';
  const otherName = NAMES[other];
  const d = dOf(today);
  const nowMin = toMin(now.slice(11, 16));

  let out = `📅 <b>Сегодня, ${WEEKDAYS[d.getUTCDay()]}, ${humanDate(today)}</b>\n\n`;

  // Мои пары
  const myLessons = mine.filter((l) => l.date === today);
  out += `<b>Твоё расписание:</b>\n`;
  if (!myLessons.length) {
    out += `Пар нет, ты ${PEOPLE[who].free} весь день! 🎉\n\n`;
  } else {
    out += myLessons.map((l) => '• ' + formatLesson(l, who)).join('\n') + '\n\n';
  }

  // Расписание партнёра
  const theirLessons = theirs ? theirs.filter((l) => l.date === today) : [];
  out += `<b>${otherName}:</b>\n`;
  if (!theirs) {
    out += `Расписание пока недоступно.\n\n`;
  } else if (!theirLessons.length) {
    out += `Пар нет, ${PEOPLE[other].free} весь день! ✨\n\n`;
  } else {
    // Текущий статус
    const cur = theirLessons.find((l) => l.startAt <= now && now < l.endAt);
    const next = theirLessons.find((l) => l.startAt > now);
    let status = '';
    if (cur) {
      status = `Сейчас на паре до ${cur.end} (${cur.subject})`;
    } else if (next) {
      status = `Сейчас ${PEOPLE[other].free} до ${next.start} (дальше ${next.subject})`;
    } else {
      status = `Пары закончились! 🎉`;
    }
    out += `<i>${esc(status)}</i>\n`;
    out += theirLessons.map((l) => '• ' + formatLesson(l, other)).join('\n') + '\n\n';
  }

  // Окна сегодня
  if (theirs) {
    const wins = jointWindows(myLessons, theirLessons, today, nowMin);
    out += `<b>👫 Свободны вместе сегодня:</b>\n`;
    if (!wins.length) {
      out += `Общих окон больше нет.\n`;
    } else {
      out += wins.map((w) => `• <b>${fmtMin(w.from)}–${fmtMin(w.to)}</b> (${dur(w.to - w.from)})`).join('\n') + '\n';
    }
  }

  return out;
}

function handleFree({ who, today, now, mine, theirs }) {
  const other = who === 'me' ? 'her' : 'me';
  const tomorrow = addDays(today, 1);
  const nowMin = toMin(now.slice(11, 16));

  if (!theirs) {
    return 'Расписание партнёра временно недоступно для расчёта окон.';
  }

  let out = `👫 <b>Свободны вместе (окна от 1 часа):</b>\n\n`;

  // Сегодня
  const winsToday = jointWindows(mine, theirs, today, nowMin);
  out += `<b>Сегодня (${humanDate(today)}):</b>\n`;
  if (!winsToday.length) {
    out += `Общих окон сегодня больше нет.\n\n`;
  } else {
    out += winsToday.map((w) => `• <b>${fmtMin(w.from)}–${fmtMin(w.to)}</b> (${dur(w.to - w.from)})`).join('\n') + '\n\n';
  }

  // Завтра
  const winsTomorrow = jointWindows(mine, theirs, tomorrow, null);
  out += `<b>Завтра (${humanDate(tomorrow)}):</b>\n`;
  if (!winsTomorrow.length) {
    out += `Общих окон на завтра нет.\n`;
  } else {
    out += winsTomorrow.map((w) => `• <b>${fmtMin(w.from)}–${fmtMin(w.to)}</b> (${dur(w.to - w.from)})`).join('\n');
  }

  return out;
}

function handleHw({ who, docs, mine }) {
  const other = who === 'me' ? 'her' : 'me';
  const myHw = [];
  const now = mskNow();
  const skey = (l) => l.subject.trim().toLowerCase().replace(/\s+/g, ' ');

  for (const [k, v] of Object.entries((docs[who] && docs[who].hw) || {})) {
    const nx = mine.find((l) => l.startAt > now && skey(l) === k);
    const all = Array.isArray(v.items) && v.items.length
      ? v.items
      : (v.text ? [{ text: v.text, done: !!v.done }] : []);
    const active = all.filter((it) => !it.done && it.text);
    for (const it of active) {
      myHw.push({ name: v.name || k, text: it.text, due: nx ? nx.date : null });
    }
  }

  let out = `📝 <b>Активные домашние задания:</b>\n\n`;
  if (!myHw.length) {
    out += `Все ДЗ выполнены! Красота ✨\n`;
  } else {
    out += myHw.map((h) => {
      const dueStr = h.due ? ` <i>(до ${humanDate(h.due)})</i>` : '';
      return `• <b>${esc(h.name)}</b>: ${esc(h.text)}${dueStr}`;
    }).join('\n\n') + '\n';
  }

  return out;
}

function handleTogether({ who, docs, today }) {
  const other = who === 'me' ? 'her' : 'me';
  const allEvents = [];
  for (const p of ['me', 'her']) {
    const doc = docs[p];
    if (doc && doc.custom) {
      for (const [id, c] of Object.entries(doc.custom)) {
        if (c && c.both && c.date >= today) {
          allEvents.push({ ...c, owner: p });
        }
      }
    }
  }

  allEvents.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.start < b.start ? -1 : 1)));

  let out = `❤️ <b>Совместные мероприятия и планы:</b>\n\n`;
  if (!allEvents.length) {
    out += `Пока нет запланированных совместных событий.\n` +
      `Ты можешь добавить совместное дело в приложении через кнопку <b>«+»</b> (выбрав формат «Вместе 👫»).`;
  } else {
    let lastDate = '';
    for (const ev of allEvents.slice(0, 15)) {
      if (ev.date !== lastDate) {
        const d = dOf(ev.date);
        out += `\n<b>${WEEKDAYS[d.getUTCDay()]}, ${humanDate(ev.date)}:</b>\n`;
        lastDate = ev.date;
      }
      const room = ev.room ? ` (📍 ${esc(ev.room)})` : '';
      const by = ev.owner === who ? '' : ` <i>[добавил(а) ${NAMES[ev.owner]}]</i>`;
      out += `• <b>${esc(ev.start)}–${esc(ev.end)}</b> ${esc(ev.title)}${room}${by}\n`;
    }
  }

  return out;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const c = cfg();
  const base = appBase(req);

  if (!c.botToken) {
    return res.status(503).json({ error: 'not_configured', missing: ['BOT_TOKEN'] });
  }

  // Настройка webhook: GET /api/bot?setup=1
  if (req.method === 'GET') {
    const u = new URL(req.url, 'http://localhost');
    if (u.searchParams.get('setup') === '1') {
      const webhookUrl = `${base}/api/bot`;
      try {
        const [whRes, cmdRes] = await Promise.all([
          fetch(`https://api.telegram.org/bot${c.botToken}/setWebhook?url=${encodeURIComponent(webhookUrl)}`).then((r) => r.json()),
          fetch(`https://api.telegram.org/bot${c.botToken}/setMyCommands`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              commands: [
                { command: 'today', description: 'Расписание на сегодня и свободные окна' },
                { command: 'tomorrow', description: 'Расписание и дайджест на завтра' },
                { command: 'free', description: 'Когда свободны вместе' },
                { command: 'hw', description: 'Актуальные домашние задания' },
                { command: 'together', description: 'Совместные мероприятия' },
                { command: 'help', description: 'Справка и меню' },
              ],
            }),
          }).then((r) => r.json()),
        ]);
        return res.status(200).json({ ok: true, webhookUrl, setWebhook: whRes, setMyCommands: cmdRes });
      } catch (e) {
        return res.status(502).json({ error: 'telegram_api_failed', message: String((e && e.message) || e) });
      }
    }
    return res.status(200).json({ status: 'ok', name: 'parket-bot', webhook: `${base}/api/bot` });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const update = req.body || {};
  const msg = update.message;
  if (!msg || !msg.chat) {
    return res.status(200).json({ ok: true, skipped: 'no_message' });
  }

  const chatId = String(msg.chat.id);
  const who = c.owners[chatId];

  // Чужой пользователь
  if (!who) {
    await sendTelegramMessage(
      c.botToken,
      chatId,
      '👋 Привет! Этот бот — персональный помощник для расписания Кирилла и Маши («ПАР·КЕТ»). Доступ разрешён только владельцам.'
    );
    return res.status(200).json({ ok: true, skipped: 'unauthorized_user', chatId });
  }

  const text = String(msg.text || '').trim();
  const keyboard = getMainKeyboard(base);
  const now = mskNow();
  const today = now.slice(0, 10);
  const tomorrow = addDays(today, 1);

  // Обработка /start и /help
  if (text === '/start' || text === '/help' || text.startsWith('/start ') || text === '📱 Открыть ПАР·КЕТ') {
    await sendTelegramMessage(c.botToken, chatId, handleStart(who, base), keyboard);
    return res.status(200).json({ ok: true, command: 'start' });
  }

  // Загружаем данные
  const other = who === 'me' ? 'her' : 'me';
  let sMe, sHer, dMe, dHer;
  try {
    [sMe, sHer, dMe, dHer] = await Promise.all([
      fetchSchedule(base, 'me'),
      fetchSchedule(base, 'her'),
      getDoc('me'),
      getDoc('her'),
    ]);
  } catch (e) {
    await sendTelegramMessage(c.botToken, chatId, '⚠️ Не удалось загрузить расписание. Попробуй через минуту.', keyboard);
    return res.status(200).json({ ok: true, error: 'load_failed' });
  }

  const docs = { me: dMe, her: dHer };
  const schedules = { me: sMe ? sMe.lessons : null, her: sHer ? sHer.lessons : null };
  const mine = mergeLessons(schedules[who], docs[who], docs[other]);
  const theirs = schedules[other] ? mergeLessons(schedules[other], docs[other], docs[who]) : null;

  let replyText = '';

  if (text === '/today' || text === '📅 Сегодня') {
    replyText = handleToday({ who, today, now, mine, theirs });
  } else if (text === '/tomorrow' || text === '🌅 Завтра') {
    replyText = buildDigest({ who, date: tomorrow, now, schedules, docs, changes: [] });
  } else if (text === '/free' || text === '👫 Свободны вместе') {
    replyText = handleFree({ who, today, now, mine, theirs });
  } else if (text === '/hw' || text === '📝 ДЗ') {
    replyText = handleHw({ who, docs, mine });
  } else if (text === '/together' || text === '❤️ Совместные дела') {
    replyText = handleTogether({ who, docs, today });
  } else {
    replyText = `Я не понял команду «${esc(text)}».\nВыбери кнопку на клавиатуре или отправь /help.`;
  }

  await sendTelegramMessage(c.botToken, chatId, replyText, keyboard);
  return res.status(200).json({ ok: true });
};
