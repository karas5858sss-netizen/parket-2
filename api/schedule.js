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
// subgroup: номер п/г для пар, которые вуз делит по подгруппам (напр. воен. подготовка).
//   null  -> все п/г схлопываются в одну карточку (в variants лежат все варианты)
//   число -> показывается только эта п/г
const PROFILES = {
  me: { label: 'Я', source: 'msgu', groupId: 338, groupName: 'Мо-24', subgroup: null },
  her: { label: 'Она', source: 'donstu', groupId: 73381, groupName: 'ДСО12', subgroup: null },
};

// Все числа в одном месте (тесты подменяют их на маленькие).
const CONFIG = {
  TIMEOUT_MS: 5000,          // одна попытка запроса к вузу
  DEADLINE_MS: 25000,        // общий бюджет времени на весь ответ; недели, не успевшие в него, идут в errors
  CONCURRENCY: 5,            // недель одновременно
  FALLBACK_WEEKS_BACK: 1,    // запасной диапазон, если список дат «сломан» (не «не отвечает»):
  FALLBACK_WEEKS_AHEAD: 8,   //   неделя назад и 8 вперёд = 10 недель
  MAX_INVALID_SHARE: 0.2,    // если битых записей больше этой доли (и не меньше MIN_INVALID_TO_FAIL), ответ вуза испорчен
  MIN_INVALID_TO_FAIL: 3,
};
const DAY = 86400000;

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
const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;
const RE_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const isRealDate = (s) => typeof s === 'string' && RE_DATE.test(s) && toIso(parseIso(s)) === s;

// ---- сеть ----
// Что повторяем: сеть, таймаут, 408, 429 и 5xx. Остальные 4xx и «ответ не JSON» повтора не заслуживают.
function upstreamError(message, transient, status) {
  const e = new Error(message);
  e.transient = transient;
  if (status) e.status = status;
  return e;
}
const isTransientStatus = (s) => s === 408 || s === 429 || s >= 500;

async function getJson(url, deadline) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    const left = deadline - Date.now();
    if (left <= 0) throw lastErr || upstreamError('deadline exceeded', true);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Math.min(CONFIG.TIMEOUT_MS, left));
    try {
      let r;
      try {
        r = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
      } catch (e) {
        throw upstreamError(e && e.name === 'AbortError' ? 'timeout' : 'network: ' + ((e && e.message) || e), true);
      }
      if (!r.ok) throw upstreamError('HTTP ' + r.status, isTransientStatus(r.status), r.status);
      try {
        return await r.json();
      } catch (e) {
        throw e && e.name === 'AbortError' ? upstreamError('timeout', true) : upstreamError('bad response (not JSON)', false);
      }
    } catch (e) {
      lastErr = e;
      if (!e.transient) break;
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

// ---- нормализация и проверка одной пары ----
// Контракт: date 'ГГГГ-ММ-ДД', start/end 'ЧЧ:ММ', startAt/endAt 'ГГГГ-ММ-ДДTЧЧ:ММ:СС' (местное время вуза, без пояса).
// startAt/endAt собираем сами из даты и времени, а не берём на веру из полей вуза.
const KIND = /^(лек|пр|лаб|сем)\.?\s+/i;
function normalize(x) {
  const title = String(x['дисциплина'] || '').trim();
  const m = title.match(KIND);
  const date = String(x['дата']).slice(0, 10);
  const start = x['начало'];
  const end = x['конец'];
  return {
    id: x['код'],
    date,
    start,
    end,
    startAt: `${date}T${start}:00`,
    endAt: `${date}T${end}:00`,
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

function validLesson(l) {
  if (!(typeof l.id === 'number' || (typeof l.id === 'string' && l.id !== ''))) return false;
  if (!isRealDate(l.date)) return false;
  if (!RE_TIME.test(l.start) || !RE_TIME.test(l.end) || l.end <= l.start) return false;
  return typeof l.subject === 'string' && l.subject.trim() !== '';
}

// Вуз выкладывает п/г как отдельные пары с суффиксом ", п/г N" в названии.
const SG = /,?\s*п\/г\s*(\d+)\s*$/i;

function collapseSubgroups(lessons, wanted) {
  const out = [];
  const groups = new Map();
  for (const l of lessons) {
    const m = l.title.match(SG);
    if (!m) {
      out.push(l);
      continue;
    }
    const n = Number(m[1]);
    const base = {
      ...l,
      title: l.title.replace(SG, '').trim(),
      subject: l.subject.replace(SG, '').trim(),
    };
    if (wanted) {
      if (n === wanted) out.push({ ...base, subgroup: n });
      continue;
    }
    const key = [l.date, l.start, l.end, base.title].join('|');
    const v = { n, teacher: l.teacher, room: l.room };
    const g = groups.get(key);
    if (g) g.variants.push(v);
    else {
      const card = { ...base, subgroup: 0, variants: [v] };
      groups.set(key, card);
      out.push(card);
    }
  }
  for (const g of groups.values()) {
    g.variants.sort((a, b) => a.n - b.n);
    g.teacher = '';
    g.room = '';
  }
  return out;
}

// ---- handler ----
function fail(res, key, p, status, body) {
  console.error('schedule:', key, p.source, status, JSON.stringify(body).slice(0, 300));
  res.setHeader('Cache-Control', 'no-store');
  return res.status(status).json(body);
}

module.exports = async (req, res) => {
  if (req.method && req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  const key = String((req.query && req.query.profile) || '');
  const p = PROFILES[key];
  if (!p) {
    return res.status(400).json({ error: 'unknown profile', allowed: Object.keys(PROFILES) });
  }
  const api = (path) => `${SOURCES[p.source]}/api/${path}`;
  const deadline = Date.now() + CONFIG.DEADLINE_MS;

  // 1) какие дни вообще есть в расписании этой группы
  let dates = [];
  let range = null;
  let datesErr = null;
  try {
    const d = (await getJson(api(`GetRaspDates?idGroup=${p.groupId}`), deadline)).data || {};
    dates = Array.isArray(d.dates) ? d.dates.filter(isRealDate) : [];
    range = { min: d.minDate || null, max: d.maxDate || null };
  } catch (e) {
    datesErr = e;
  }
  // Сервер вуза не отвечает: недели тоже не ответят, ждать их бессмысленно.
  if (datesErr && datesErr.transient) {
    return fail(res, key, p, 502, { error: 'upstream unavailable', source: p.source, reason: datesErr.message });
  }

  // 2) одна неделя = один запрос: берём по одной дате на каждую неделю
  const weeks = new Map(); // понедельник -> дата для sdate
  for (const s of dates) {
    const mon = mondayOf(parseIso(s));
    if (!weeks.has(mon)) weeks.set(mon, s);
  }
  // Запасной вариант только если список дат «сломан» (4xx, не JSON) или пуст, а не когда вуз лежит.
  if (weeks.size === 0) {
    const now = mondayOf(Date.now());
    for (let w = -CONFIG.FALLBACK_WEEKS_BACK; w <= CONFIG.FALLBACK_WEEKS_AHEAD; w++) {
      const mon = now + w * 7 * DAY;
      weeks.set(mon, toIso(mon));
    }
  }
  const sdates = [...weeks.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]);

  // 3) тянем недели параллельно и склеиваем без дублей
  const results = await pool(
    sdates,
    async (sdate) => {
      const j = await getJson(api(`Rasp?idGroup=${p.groupId}&sdate=${sdate}`), deadline);
      return (j.data && j.data.rasp) || [];
    },
    CONFIG.CONCURRENCY
  );

  const byId = new Map();
  const errors = [];
  let valid = 0;
  let invalid = 0;
  results.forEach((r, i) => {
    if (r.e) { errors.push({ sdate: sdates[i], error: r.e }); return; }
    for (const x of r.v) {
      const l = normalize(x);
      if (validLesson(l)) { valid += 1; byId.set(l.id, l); } else invalid += 1;
    }
  });

  if (errors.length === sdates.length) {
    return fail(res, key, p, 502, { error: 'upstream failed', source: p.source, errors });
  }
  if (invalid >= CONFIG.MIN_INVALID_TO_FAIL && invalid / (valid + invalid) > CONFIG.MAX_INVALID_SHARE) {
    return fail(res, key, p, 502, { error: 'upstream malformed', source: p.source, invalid, valid });
  }

  const sorted = [...byId.values()].sort((a, b) => (a.startAt < b.startAt ? -1 : a.startAt > b.startAt ? 1 : 0));
  const lessons = collapseSubgroups(sorted, p.subgroup);
  res.setHeader('Cache-Control', errors.length ? 'no-store' : 's-maxage=900, stale-while-revalidate=3600');
  return res.status(200).json({
    profile: key,
    label: p.label,
    group: p.groupName,
    groupId: p.groupId,
    source: p.source,
    range,
    weeks: sdates.length,
    errors,
    invalid,
    fetchedAt: new Date().toISOString(),
    lessons,
  });
};

module.exports.__internals = { CONFIG, normalize, validLesson, collapseSubgroups, getJson };
