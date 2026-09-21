// js/domain.js — Логика без HTML: ключи предметов, свои пары, журнал изменений, номера пар, общие окна.
// Нужны: core, state. Файлы общие по области видимости (обычные скрипты), порядок подключения в index.html важен.
(window.PARTS = window.PARTS || []).push('domain');

const colorOf = (sk) => { const i = curDoc().colors[sk]; return Number.isInteger(i) && PALETTE[i] ? PALETTE[i][0] : null; };

// ---------- ключи: ДЗ привязано к предмету, «пройдена» к конкретной паре ----------
const skey = (l) => l.subject.trim().toLowerCase().replace(/\s+/g, ' ');
const lkey = (l) => l.date + '|' + l.start + '|' + skey(l);
const curDoc = () => state.docs[state.profile] || emptyDoc();
const canEdit = () => !!state.who && state.who === state.profile;
const isDone = (l) => !!curDoc().done[lkey(l)];

// ---------- свои пары: превращаем записи в обычные карточки ----------
function expandCustom(id, c) {
  const skip = new Set(c.skip || []);
  const dates = [];
  if (c.until) { for (let d = c.date, n = 0; d <= c.until && n <= 60; d = addDays(d, 7), n++) dates.push(d); } else dates.push(c.date);
  return dates.filter((d) => !skip.has(d)).map((d) => ({
    id: 'c:' + id + ':' + d, cid: id, custom: true, date: d, start: c.start, end: c.end,
    startAt: d + 'T' + c.start + ':00', endAt: d + 'T' + c.end + ':00', num: 0,
    kind: c.kind || null, subject: c.title, title: c.title, teacher: c.teacher || '', room: c.room || '',
    color: null, subgroup: 0, weekType: 0, replaced: false,
  }));
}
function allLessons(profile) {
  const p = profile || state.profile;
  const base = (state.data[p] || {}).lessons || [];
  const doc = state.docs[p];
  const extra = [];
  if (doc && doc.custom) for (const [id, c] of Object.entries(doc.custom)) extra.push(...expandCustom(id, c));
  if (!extra.length) return base;
  return base.concat(extra).sort((a, b) => (a.startAt < b.startAt ? -1 : a.startAt > b.startAt ? 1 : 0));
}

// ---------- журнал изменений расписания ----------
const GEN = { me: 'Кирилла', her: 'Маши' };
const changesOf = (p) => (state.changes && state.changes[p]) || [];
const seenOf = (p) => { const d = state.who && state.docs[state.who]; return (d && d.prefs && d.prefs.seen && d.prefs.seen[p]) || ''; };
const relevantChanges = (p) => {
  const today = nowStr().slice(0, 10);
  return changesOf(p).filter((e) => e.type === 'published' || !e.date || e.date >= today);
};
const unseenChanges = (p) => relevantChanges(p).filter((e) => e.t > seenOf(p));

function changeFor(l) {
  if (l.custom) return null;
  return unseenChanges(state.profile).find((x) => x.lid === String(l.id) && (x.type === 'moved' || x.type === 'changed' || x.type === 'added')) || null;
}

function pairNo(l, profile) {
  const i = (SLOTS[profile || state.profile] || []).findIndex((sl) => sl[0] === l.start);
  if (i >= 0) return i + 1;
  return !l.custom && l.num > 0 ? l.num : 0;   // не по сетке: номер из расписания вуза, у своих пар без номера
}
// ---------- партнёр: что делает сейчас, общие окна ----------
const DAY_FROM = 8 * 60, DAY_TO = 22 * 60, MIN_WINDOW = 60;
const fmtMin = (m) => pad(Math.floor(m / 60)) + ':' + pad(m % 60);
const roomBit = (l) => (l.room ? ', ауд. ' + (l.room.includes(' - ') ? l.room.split(' - ')[0] : l.room) : '');

function freeOf(profile, date) {
  const busy = allLessons(profile).filter((l) => l.date === date).map((l) => [toMin(l.start), toMin(l.end)]).sort((a, b) => a[0] - b[0]);
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

function jointWindows(date) {
  if (!state.data.me || !state.data.her) return null;
  const a = freeOf('me', date);
  const b = freeOf('her', date);
  const now = nowStr();
  const from = date === now.slice(0, 10) ? Math.max(DAY_FROM, toMin(now.slice(11, 16))) : DAY_FROM;
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
