// lib/slots.js — сетка пар у каждого. Значения берутся из config/profiles.js (PEOPLE.<профиль>.slots) —
// это единственное место, где их нужно менять. Здесь только номер пары по времени начала (pairNo).
// Номер пары определяется по времени начала.

const PEOPLE = require('../config/profiles.js');
const SLOTS = { me: PEOPLE.me.slots, her: PEOPLE.her.slots };

const DAY_FROM = 8 * 60, DAY_TO = 22 * 60, MIN_WINDOW = 60;
const toMin = (t) => { const [h, m] = (t || '00:00').split(':').map(Number); return (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m); };
const fmtMin = (m) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
const dur = (m) => {
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return (h ? h + ' ч' : '') + (rem ? ' ' + rem + ' мин' : '');
};

// Номер пары: по сетке, иначе номер из расписания вуза, иначе 0 (не нумеруется).
function pairNo(profile, l) {
  const i = (SLOTS[profile] || []).findIndex((s) => s[0] === l.start);
  if (i >= 0) return i + 1;
  return !l.custom && l.num > 0 ? l.num : 0;
}

function freeOf(lessons, date) {
  const busy = (lessons || []).filter((l) => l.date === date).map((l) => [toMin(l.start), toMin(l.end)]).sort((a, b) => a[0] - b[0]);
  const free = [];
  let cur = DAY_FROM;
  for (const [st, en] of busy) {
    if (cur >= DAY_TO) break;
    if (st > cur) free.push([cur, Math.min(st, DAY_TO)]);
    cur = Math.max(cur, en);
  }
  if (cur < DAY_TO) free.push([cur, DAY_TO]);
  return free;
}

function jointWindows(lessonsA, lessonsB, date, nowMin) {
  const a = freeOf(lessonsA, date);
  const b = freeOf(lessonsB, date);
  const from = nowMin != null ? Math.max(DAY_FROM, nowMin) : DAY_FROM;
  const out = [];
  for (const [s1, e1] of a) {
    for (const [s2, e2] of b) {
      const st = Math.max(s1, s2, from);
      const en = Math.min(e1, e2);
      if (en - st >= MIN_WINDOW) out.push({ from: st, to: en });
    }
  }
  return out.sort((x, y) => x.from - y.from);
}

module.exports = { SLOTS, pairNo, toMin, fmtMin, dur, freeOf, jointWindows, DAY_FROM, DAY_TO };
