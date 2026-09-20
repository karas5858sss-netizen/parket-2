// lib/digest.js — текст вечернего напоминания. Чистые функции, без сети и env.
//
// Что в сообщении (для получателя who):
//   1) его пары на завтра,
//   2) всё активное ДЗ (не только на завтра) с датой ближайшей пары предмета,
//   3) время занятости партнёра завтра (с первой пары до конца последней).

const NAMES = { me: 'Кирилл', her: 'Маша' };
const BUSY = { me: 'занят', her: 'занята' };
const FREE = { me: 'свободен', her: 'свободна' };
const WEEKDAY = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const WD_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const HW_LIMIT = 15;

const esc = (s) => String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const dOf = (s) => new Date(s + 'T00:00:00Z');
const addDays = (s, n) => new Date(dOf(s).getTime() + n * 864e5).toISOString().slice(0, 10);
const skey = (l) => l.subject.trim().toLowerCase().replace(/\s+/g, ' ');
const humanDate = (s) => { const d = dOf(s); return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()]; };

// Московское «сейчас» в формате 'YYYY-MM-DDTHH:MM:SS' (как startAt у пар).
const mskNow = () => new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 19);

// ---------- свои пары -> обычные пары (та же логика, что в приложении) ----------
function expandCustom(id, c) {
  const skip = new Set(c.skip || []);
  const dates = [];
  if (c.until) { for (let d = c.date, n = 0; d <= c.until && n <= 60; d = addDays(d, 7), n++) dates.push(d); } else dates.push(c.date);
  return dates.filter((d) => !skip.has(d)).map((d) => ({
    id: 'c:' + id + ':' + d, custom: true, date: d, start: c.start, end: c.end,
    startAt: d + 'T' + c.start + ':00', endAt: d + 'T' + c.end + ':00',
    kind: c.kind || null, subject: c.title, teacher: c.teacher || '', room: c.room || '',
  }));
}

function mergeLessons(base, doc) {
  const extra = [];
  if (doc && doc.custom) for (const [id, c] of Object.entries(doc.custom)) extra.push(...expandCustom(id, c));
  return (base || []).concat(extra).sort((a, b) => (a.startAt < b.startAt ? -1 : a.startAt > b.startAt ? 1 : 0));
}

function lessonLine(l) {
  const room = l.room ? ', ауд. ' + (l.room.includes(' - ') ? l.room.split(' - ')[0] : l.room) : '';
  const sub = l.variants && l.variants.length ? ' (по подгруппам)' : '';
  return `${l.start}–${l.end} ${esc(l.subject)}${l.kind ? ' (' + esc(l.kind) + ')' : ''}${esc(room)}${sub}`;
}

function dueText(due, tomorrow) {
  if (!due) return '';
  if (due === tomorrow) return ' (к завтрашней паре)';
  return ` (к ${WD_SHORT[dOf(due).getUTCDay()]}, ${humanDate(due)})`;
}

// who: 'me' | 'her'; date: завтрашняя дата; now: московское время как строка;
// schedules: { me: [пары], her: [пары] } (null, если не удалось получить); docs: { me, her }
function buildDigest({ who, date, now, schedules, docs }) {
  const other = who === 'me' ? 'her' : 'me';
  const mine = mergeLessons(schedules[who], docs[who]);
  const theirs = schedules[other] ? mergeLessons(schedules[other], docs[other]) : null;
  const d = dOf(date);

  let out = `<b>Завтра, ${WEEKDAY[d.getUTCDay()]}, ${humanDate(date)}</b>\n\n`;

  const tomorrow = mine.filter((l) => l.date === date);
  out += '<b>Твои пары</b>\n' + (tomorrow.length ? tomorrow.map(lessonLine).join('\n') : 'Пар нет.') + '\n\n';

  const hw = Object.entries((docs[who] && docs[who].hw) || {})
    .filter(([, v]) => !v.done)
    .map(([k, v]) => {
      const nx = mine.find((l) => l.startAt > now && skey(l) === k);
      return { name: v.name || k, text: v.text, due: nx ? nx.date : null };
    })
    .sort((a, b) => ((a.due || '9999') < (b.due || '9999') ? -1 : (a.due || '9999') > (b.due || '9999') ? 1 : 0));
  out += '<b>ДЗ</b>\n';
  if (!hw.length) out += 'Активного ДЗ нет.';
  else {
    out += hw.slice(0, HW_LIMIT).map((h) => `• ${esc(h.name)}: ${esc(h.text)}${dueText(h.due, date)}`).join('\n');
    if (hw.length > HW_LIMIT) out += `\nи ещё ${hw.length - HW_LIMIT}`;
  }

  if (theirs) {
    const t = theirs.filter((l) => l.date === date);
    out += `\n\n<b>${NAMES[other]} завтра</b>\n`;
    if (!t.length) out += `${cap(FREE[other])} весь день.`;
    else {
      const first = t.reduce((m, l) => (l.start < m ? l.start : m), '99:99');
      const last = t.reduce((m, l) => (l.end > m ? l.end : m), '00:00');
      out += `${cap(BUSY[other])} с ${first} до ${last} (пар: ${t.length}).`;
    }
  }
  return out;
}

module.exports = { buildDigest, mskNow, addDays, mergeLessons, expandCustom, NAMES };
