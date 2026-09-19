// api/schedule.js — Vercel serverless function (Node 18+)
// GET /api/schedule?profile=me   |   GET /api/schedule?profile=her
//
// Один и тот же движок расписания стоит и у твоего вуза, и у её вуза,
// поэтому разница только в базовом адресе и id группы.

const SOURCES = {
  msgu: 'http://94.180.56.248:8080',
  donstu: 'https://edu.donstu.ru',
};

// Каждый учебный год вузы выдают новые id групп -> меняй groupId здесь.
const PROFILES = {
  me: { label: 'Я', source: 'msgu', groupId: 338, groupName: 'Мо-24' },
  her: { label: 'Она', source: 'donstu', groupId: 73381, groupName: 'ДСО12' },
};

const TIMEOUT_MS = 8000;
const CONCURRENCY = 5;
const DAY = 86400000;
const FALLBACK_WEEKS_BACK = 1;
const FALLBACK_WEEKS_AHEAD = 18;

// ---- даты (всё в UTC, чтобы пояс сервера ничего не сдвигал) ----
const pad = (n) => String(n).padStart(2, '0');
const toIso = (t) => {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};
const parseIso = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const mondayOf = (t) => t - ((new Date(t).getUTCDay() + 6) % 7) * DAY;

// ---- сеть ----
async function getJson(url) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const r = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      lastErr = e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

async function pool(items, fn, limit) {
  const out = new Array(items.length);
  let i = 0;
  const worker = async () => {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k]).then((v) => ({ v }), (e) => ({ e: String((e && e.message) || e) }));
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// ---- нормализация одной пары ----
const KIND = /^(лек|пр|лаб|сем)\.?\s+/i;
function normalize(x) {
  const title = (x['дисциплина'] || '').trim();
  const m = title.match(KIND);
  return {
    id: x['код'],
    date: String(x['дата']).slice(0, 10),
    start: x['начало'],
    end: x['конец'],
    startAt: x['датаНачала'], // локальное время вуза, без пояса
    endAt: x['датаОкончания'],
    num: x['номерЗанятия'],
    kind: m ? m[1].toLowerCase() : null,
    subject: m ? title.slice(m[0].length) : title,
    title,
    teacher: x['преподаватель'] || '',
    room: x['аудитория'] || '',
    color: x['цвет'] || null,
    subgroup: x['номерПодгруппы'] || 0,
    weekType: x['типНедели'],
    replaced: !!x['замена'],
  };
}

// ---- handler ----
module.exports = async (req, res) => {
  const key = String((req.query && req.query.profile) || '');
  const p = PROFILES[key];
  if (!p) {
    return res.status(400).json({ error: 'unknown profile', allowed: Object.keys(PROFILES) });
  }
  const api = (path) => `${SOURCES[p.source]}/api/${path}`;

  // 1) какие дни вообще есть в расписании этой группы
  let dates = [];
  let range = null;
  try {
    const d = (await getJson(api(`GetRaspDates?idGroup=${p.groupId}`))).data || {};
    dates = Array.isArray(d.dates) ? d.dates : [];
    range = { min: d.minDate || null, max: d.maxDate || null };
  } catch (_) {
    /* упадём на запасной вариант ниже */
  }

  // 2) одна неделя = один запрос: берём по одной дате на каждую неделю
  const weeks = new Map(); // понедельник -> дата для sdate
  for (const s of dates) {
    const mon = mondayOf(parseIso(s));
    if (!weeks.has(mon)) weeks.set(mon, s);
  }
  if (weeks.size === 0) {
    const now = mondayOf(Date.now());
    for (let w = -FALLBACK_WEEKS_BACK; w <= FALLBACK_WEEKS_AHEAD; w++) {
      const mon = now + w * 7 * DAY;
      weeks.set(mon, toIso(mon));
    }
  }
  const sdates = [...weeks.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]);

  // 3) тянем недели параллельно (по 5 штук) и склеиваем без дублей
  const results = await pool(
    sdates,
    async (sdate) => {
      const j = await getJson(api(`Rasp?idGroup=${p.groupId}&sdate=${sdate}`));
      return (j.data && j.data.rasp) || [];
    },
    CONCURRENCY
  );

  const byId = new Map();
  const errors = [];
  results.forEach((r, i) => {
    if (r.e) errors.push({ sdate: sdates[i], error: r.e });
    else for (const x of r.v) byId.set(x['код'], normalize(x));
  });
  const lessons = [...byId.values()].sort((a, b) => (a.startAt < b.startAt ? -1 : a.startAt > b.startAt ? 1 : 0));

  if (errors.length === sdates.length) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: 'upstream failed', source: p.source, errors });
  }
  res.setHeader(
    'Cache-Control',
    errors.length ? 'no-store' : 's-maxage=900, stale-while-revalidate=3600'
  );
  return res.status(200).json({
    profile: key,
    label: p.label,
    group: p.groupName,
    groupId: p.groupId,
    source: p.source,
    range,
    weeks: sdates.length,
    errors,
    fetchedAt: new Date().toISOString(),
    lessons,
  });
};
