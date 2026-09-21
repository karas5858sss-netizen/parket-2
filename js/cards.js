// js/cards.js — HTML-кусочки: карточка пары, блоки «что изменилось», партнёр, общие окна, переключатель масштаба.
// Нужны: core, state, domain. Файлы общие по области видимости (обычные скрипты), порядок подключения в index.html важен.
(window.PARTS = window.PARTS || []).push('cards');

function changesBlock() {
  const p = state.profile;
  const list = relevantChanges(p);
  if (!list.length || !state.who) return '';
  const seen = seenOf(p);
  const unseen = list.filter((e) => e.t > seen);
  const row = (e) => `<div class="chgitem${e.t > seen ? ' new' : ''}">${esc(e.text)}</div>`;
  if (!unseen.length) {
    return `<details class="past"><summary>Прошлые изменения: ${list.length}</summary>${list.slice(0, 10).map(row).join('')}</details>`;
  }
  const who = p === state.who ? 'Что изменилось' : 'Что изменилось у ' + GEN[p];
  return `<section class="chg"><div class="cap">${who}: новых ${unseen.length}</div>` +
    unseen.slice(0, 8).map(row).join('') +
    (unseen.length > 8 ? `<div class="meta">и ещё ${unseen.length - 8}</div>` : '') +
    '<button class="btn" data-act="chg-read">Прочитано</button></section>';
}

// ---------- карточка пары ----------
function lessonHTML(l) {
  const kind = { 'лек': 'lec', 'пр': 'pr', 'лаб': 'lab' }[l.kind] || 'other';
  const badge = l.kind ? `<span class="badge k-${kind}">${esc(l.kind)}</span>` : '';
  const doc = curDoc();
  const hw = doc.hw[skey(l)];
  let meta = '';
  if (l.teacher) meta += `<div class="meta">${esc(l.teacher)}</div>`;
  if (l.room) {
    const short = l.room.includes(' - ') ? l.room.split(' - ')[0] : l.room;
    meta += `<div class="meta" title="${esc(l.room)}">ауд. ${esc(short)}</div>`;
  }
  if (l.variants && l.variants.length) {
    const v = l.variants;
    meta += `<details><summary>Подгруппы ${v[0].n}–${v[v.length - 1].n}</summary><div class="vars">` +
      v.map((x) => `<div>п/г ${x.n}: ${esc(x.teacher)}, ${esc(x.room)}</div>`).join('') + '</div></details>';
  }
  if (hw && !hw.done) meta += `<div class="hw"><i class="rd"></i><span>${esc(hw.text)}</span></div>`;
  const done = !!doc.done[lkey(l)];
  if (done) meta += '<div class="meta okline">✓ пройдена</div>';
  const col = colorOf(skey(l));
  const chg = changeFor(l);
  const chgBadge = chg ? `<span class="badge k-chg" title="${esc(chg.text)}">${{ moved: 'перенесена', changed: 'изменено', added: 'новая' }[chg.type]}</span>` : '';
  if (chg && chg.type === 'moved' && chg.was) meta += `<div class="meta">Было: ${WD[dow(chg.was.d)]}, ${human(chg.was.d)}, ${esc(chg.was.s)}</div>`;
  return `<article class="lesson${done ? ' isdone' : ''}${col ? ' colored' : ''}"${col ? ` style="--c:${col}"` : ''} tabindex="0" role="button" data-act="open" data-k="${esc(lkey(l))}">` +
    `<div class="t"><b>${esc(l.start)}</b><span>${esc(l.end)}</span>${pairNo(l) ? `<span class="pn">${pairNo(l)} пара</span>` : ''}</div>` +
    `<div><div class="ttl">${badge}${chgBadge}${l.custom ? '<span class="badge k-own">своя</span>' : ''}${esc(l.subject)}</div>${meta}</div></article>`;
}

function hwListHTML() {
  const items = Object.entries(curDoc().hw).filter(([, v]) => !v.done).sort((a, b) => (b[1].t || 0) - (a[1].t || 0));
  if (!items.length) return '';
  return '<h2>Активное ДЗ</h2>' + items.map(([k, v]) =>
    `<button class="hwitem${colorOf(k) ? ' colored' : ''}"${colorOf(k) ? ` style="--c:${colorOf(k)}"` : ''} data-act="hw" data-sk="${esc(k)}"><b>${esc(v.name || k)}</b><span>${esc(v.text)}</span></button>`).join('');
}

function jointBlock(date) {
  const w = jointWindows(date);
  if (w === null) return '';
  const body = w.length
    ? w.map((x) => `<div class="win"><b>${fmtMin(x.from)}–${fmtMin(x.to)}</b><span>${dur(x.to - x.from)}</span></div>`).join('')
    : '<div class="meta">Общих окон нет.</div>';
  return `<section class="joint"><div class="cap">Свободны вместе (окна от 1 ч), время московское</div>${body}</section>`;
}

function partnerCardHTML() {
  if (!state.who || state.profile !== state.who) return '';
  const pp = otherOf(state.who);
  if (!state.data[pp]) return '';
  const now = nowStr();
  const today = now.slice(0, 10);
  const day = allLessons(pp).filter((l) => l.date === today);
  const name = LABEL[pp];
  const cur = day.find((l) => l.startAt <= now && now < l.endAt);
  const next = day.find((l) => l.startAt > now);
  let head;
  let sub = '';
  if (cur) {
    head = `${name} на паре до ${cur.end}`;
    sub = cur.subject + roomBit(cur);
  } else if (next) {
    head = `${name} ${FREE[pp]} до ${next.start}`;
    sub = 'Дальше: ' + next.subject + roomBit(next);
  } else if (day.length) {
    head = `${name} ${FREE[pp]}, пары закончились в ${day.reduce((m, l) => (l.end > m ? l.end : m), '00:00')}`;
  } else {
    head = `${name}: сегодня пар нет`;
  }
  const pu = unseenChanges(pp).length;
  const chgLine = pu ? `В расписании ${GEN[pp]} есть изменения: ${pu}` : '';
  const w = jointWindows(today);
  let joint = '';
  if (w) joint = w.length ? 'Вместе свободны: ' + w.slice(0, 3).map((x) => fmtMin(x.from) + '–' + fmtMin(x.to)).join(', ') : 'Общих окон сегодня больше нет';
  return `<section class="partner" style="--pa:${pp === 'her' ? '#c93d63' : '#1f6fd1'}"><i class="pd"></i><div>` +
    `<div class="ptl">${esc(head)}</div>${sub ? `<div class="meta">${esc(sub)}</div>` : ''}${joint ? `<div class="meta">${esc(joint)}</div>` : ''}${chgLine ? `<div class="meta">${esc(chgLine)}</div>` : ''}</div></section>`;
}

// ---------- «Календарь»: переключатель масштаба ----------
function calSeg() {
  return '<div class="seg" role="group" aria-label="Масштаб календаря">' +
    [['week', 'Неделя'], ['month', 'Месяц'], ['subjects', 'Предметы']].map(([k, t]) => `<button data-act="tab" data-tab="${k}" aria-pressed="${state.tab === k}">${t}</button>`).join('') + '</div>';
}

// ---------- сообщения о состоянии общего хранилища ----------
function syncNote() {
  const s = state.sync;
  if (s.code === 'browser') return '<div class="note">ДЗ и отметки работают только внутри Telegram.</div>';
  if (s.code === 'off') return '<div class="note warn">Общее хранилище ещё не настроено на сервере, ДЗ пока недоступно.</div>';
  if (s.code === 'denied') return `<div class="note warn">Нет доступа к ДЗ. Твой Telegram ID: <b>${esc(s.id)}</b>. Его нужно добавить в ME_TG_ID или HER_TG_ID на Vercel.</div>`;
  if (s.code === 'error') return `<div class="note">Не удалось получить ДЗ (${esc(s.msg || 'ошибка')}), показаны сохранённые.</div>`;
  return '';
}
