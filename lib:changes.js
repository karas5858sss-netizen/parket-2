// lib/changes.js — сравнение версий расписания и журнал изменений. Чистые функции, без сети.
//
// Снимок: { at, max, lessons: { id: {d,s,e,n,k,t,r,v} } } — только пары от «сегодня» и позже.
// Запись журнала: { id, t, type, lid, date, start, end, subject, kind, was, now, fields, text, till, count }
// Типы: moved (перенесена), changed (изменена аудитория/преподаватель/…), added, removed, published.

const crypto = require('crypto');

const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const LOG_CAP = 60;
const BULK = 6; // больше стольких однотипных изменений сворачиваем в одну строку
const LOG_MAX_AGE_DAYS = 21;

const dOf = (s) => new Date(s + 'T00:00:00Z');
const addDays = (s, n) => new Date(dOf(s).getTime() + n * 864e5).toISOString().slice(0, 10);
const mondayOf = (s) => addDays(s, -((dOf(s).getUTCDay() + 6) % 7));
const fd = (s) => `${WD[dOf(s).getUTCDay()]} ${dOf(s).getUTCDate()} ${MONTHS[dOf(s).getUTCMonth()]}`;
const roomShort = (r) => (r && r.includes(' - ') ? r.split(' - ')[0] : r || '');

// ---------- снимок ----------
function compact(l) {
  return {
    d: l.date, s: l.start, e: l.end, n: l.subject, k: l.kind || '', t: l.teacher || '', r: l.room || '',
    v: (l.variants || []).map((x) => x.n + ':' + x.teacher + ':' + x.room).join('|'),
  };
}

function buildSnapshot(lessons, at, today) {
  const map = {};
  let max = null;
  for (const l of lessons) {
    if (l.custom) continue;
    if (!max || l.date > max) max = l.date;
    if (l.date >= today) map[String(l.id)] = compact(l);
  }
  return { at, max, lessons: map };
}

const futureOf = (snap, today) => Object.entries(snap.lessons).filter(([, x]) => x.d >= today);

// ---------- сравнение ----------
function describe(o, n) {
  const moved = o.d !== n.d || o.s !== n.s || o.e !== n.e;
  const fields = [];
  if (o.r !== n.r) fields.push('room');
  if (o.t !== n.t) fields.push('teacher');
  if (o.n !== n.n) fields.push('subject');
  if (o.k !== n.k) fields.push('kind');
  if (o.v !== n.v) fields.push('variants');
  if (!moved && !fields.length) return null;
  return { type: moved ? 'moved' : 'changed', fields };
}

function diffSnapshots(oldS, newS, today) {
  const out = [];
  const removed = [];
  const added = [];
  const oldFuture = futureOf(oldS, today);

  for (const [id, n] of futureOf(newS, today)) {
    const o = oldS.lessons[id];
    if (o) {
      const c = describe(o, n);
      if (c) out.push({ type: c.type, lid: id, was: o, now: n, fields: c.fields });
    } else added.push([id, n]);
  }
  for (const [id, o] of oldFuture) if (!newS.lessons[id]) removed.push([id, o]);

  // 1) пересозданные пары: тот же день, время и предмет под новым номером — не изменение
  for (let i = removed.length - 1; i >= 0; i--) {
    const [, o] = removed[i];
    const j = added.findIndex(([, n]) => n.d === o.d && n.s === o.s && n.e === o.e && n.n === o.n);
    if (j < 0) continue;
    const [nid, n] = added[j];
    const c = describe(o, n);
    if (c) out.push({ type: c.type, lid: nid, was: o, now: n, fields: c.fields });
    removed.splice(i, 1);
    added.splice(j, 1);
  }

  // 2) перенос под новым номером: предмет, тип и неделя те же, количество совпадает
  const keyOf = (x) => x.n + '|' + x.k + '|' + mondayOf(x.d);
  const groupsR = {};
  const groupsA = {};
  removed.forEach((r) => { (groupsR[keyOf(r[1])] = groupsR[keyOf(r[1])] || []).push(r); });
  added.forEach((a) => { (groupsA[keyOf(a[1])] = groupsA[keyOf(a[1])] || []).push(a); });
  const pairedR = new Set();
  const pairedA = new Set();
  const byTime = (a, b) => (a[1].d + a[1].s < b[1].d + b[1].s ? -1 : 1);
  for (const key of Object.keys(groupsR)) {
    const rs = groupsR[key];
    const as = groupsA[key];
    if (!as || as.length !== rs.length) continue;
    rs.sort(byTime); as.sort(byTime);
    rs.forEach((r, i) => {
      out.push({ type: 'moved', lid: as[i][0], was: r[1], now: as[i][1], fields: [] });
      pairedR.add(r[0]); pairedA.add(as[i][0]);
    });
  }

  // 3) остальное: добавления только внутри уже опубликованного периода, иначе это «новые недели»
  let beyond = 0;
  const addOut = [];
  const remOut = [];
  for (const [id, n] of added) {
    if (pairedA.has(id)) continue;
    if (oldS.max && n.d <= oldS.max) addOut.push({ type: 'added', lid: id, now: n, fields: [] });
    else beyond += 1;
  }
  for (const [id, o] of removed) {
    if (!pairedR.has(id)) remOut.push({ type: 'removed', lid: id, was: o, fields: [] });
  }
  for (const [arr, type] of [[addOut, 'added'], [remOut, 'removed']]) {
    if (arr.length <= BULK) { out.push(...arr); continue; }
    const ds = arr.map((x) => (x.now || x.was).d).sort();
    out.push({ type, bulk: true, count: arr.length, from: ds[0], to: ds[ds.length - 1], ids: arr.map((x) => x.lid).sort().join(','), fields: [] });
  }
  if (oldS.max && newS.max && newS.max > oldS.max && beyond > 0) out.push({ type: 'published', till: newS.max, count: beyond, fields: [] });
  return out.map(finish);
}

// ---------- текст и идентификатор записи ----------
function entryText(e) {
  if (e.bulk) {
    const range = e.from === e.to ? fd(e.from) : `с ${fd(e.from)} по ${fd(e.to)}`;
    return e.type === 'added' ? `Добавлено пар: ${e.count} (${range})` : `Убрано пар из расписания: ${e.count} (${range})`;
  }
  const x = e.now || e.was;
  const title = e.type === 'published' ? '' : x.n + (x.k ? ` (${x.k})` : '');
  if (e.type === 'published') return `Опубликованы новые пары до ${dOf(e.till).getUTCDate()} ${MONTHS[dOf(e.till).getUTCMonth()]} (+${e.count})`;
  if (e.type === 'added') return `Добавлена: ${title}, ${fd(x.d)}, ${x.s}–${x.e}${x.r ? ', ауд. ' + roomShort(x.r) : ''}`;
  if (e.type === 'removed') return `Отменена: ${title}, ${fd(x.d)}, ${x.s}–${x.e}`;
  const o = e.was;
  const n = e.now;
  if (e.type === 'moved') {
    const parts = o.d === n.d ? `${fd(n.d)}, ${o.s}–${o.e} → ${n.s}–${n.e}` : `${fd(o.d)} ${o.s} → ${fd(n.d)} ${n.s}`;
    const extra = [];
    if (o.r !== n.r) extra.push(`аудитория ${roomShort(o.r) || '—'} → ${roomShort(n.r) || '—'}`);
    return `Перенесена: ${title}, ${parts}${extra.length ? '; ' + extra.join('; ') : ''}`;
  }
  const what = [];
  if (e.fields.includes('room')) what.push(`аудитория ${roomShort(o.r) || '—'} → ${roomShort(n.r) || '—'}`);
  if (e.fields.includes('teacher')) what.push(`преподаватель ${o.t || '—'} → ${n.t || '—'}`);
  if (e.fields.includes('subject')) what.push(`название: ${o.n} → ${n.n}`);
  if (e.fields.includes('kind')) what.push(`тип ${o.k || '—'} → ${n.k || '—'}`);
  if (e.fields.includes('variants')) what.push('изменились аудитории подгрупп');
  return `Изменено: ${title}, ${fd(n.d)} ${n.s}: ${what.join('; ')}`;
}

function finish(e) {
  if (e.bulk) {
    return {
      id: 'bulk:' + e.type + ':' + crypto.createHash('sha1').update(e.ids).digest('hex').slice(0, 10),
      type: e.type, bulk: true, lid: null, date: e.from, start: null, end: null, subject: null, kind: '',
      was: null, now: null, fields: [], count: e.count, from: e.from, to: e.to, text: entryText(e),
    };
  }
  const x = e.now || e.was || {};
  const core = (v) => (v ? [v.d, v.s, v.e, v.n, v.k, v.t, v.r, v.v].join('~') : '');
  const id = e.type === 'published'
    ? 'pub:' + e.till
    : crypto.createHash('sha1').update([e.type, e.lid, core(e.was), core(e.now)].join('|')).digest('hex').slice(0, 12);
  const entry = {
    id, type: e.type, lid: e.lid || null, date: e.type === 'published' ? null : x.d,
    start: x.s || null, end: x.e || null, subject: x.n || null, kind: x.k || '',
    was: e.was || null, now: e.now || null, fields: e.fields || [],
  };
  if (e.type === 'published') { entry.till = e.till; entry.count = e.count; }
  entry.text = entryText(e);
  return entry;
}

// ---------- журнал ----------
function mergeLog(prev, entries, nowIso, today) {
  const byId = new Map();
  for (const it of prev || []) byId.set(it.id, it);
  for (const e of entries) if (!byId.has(e.id)) byId.set(e.id, Object.assign({ t: nowIso }, e));
  const oldest = new Date(Date.parse(nowIso) - LOG_MAX_AGE_DAYS * 864e5).toISOString();
  return [...byId.values()]
    .filter((it) => it.t >= oldest && (it.type === 'published' || !it.date || it.date >= addDays(today, -1)))
    .sort((a, b) => (a.t < b.t ? 1 : a.t > b.t ? -1 : 0))
    .slice(0, LOG_CAP);
}

// Подозрительное сокращение расписания (сбой источника): не принимаем сразу, ждём подтверждения.
function isSuspicious(oldS, newS, today) {
  const a = futureOf(oldS, today).length;
  const b = futureOf(newS, today).length;
  return (a > 0 && b === 0) || (a >= 10 && b < a * 0.4);
}

module.exports = { buildSnapshot, diffSnapshots, mergeLog, isSuspicious, entryText, addDays };
