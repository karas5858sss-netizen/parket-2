// js/views.js — Экраны: Сегодня, Неделя, Месяц, Предметы, Поиск, Итоги.
// Нужны: core, state, domain, cards. Файлы общие по области видимости (обычные скрипты), порядок подключения в index.html важен.
(window.PARTS = window.PARTS || []).push('views');

// ---------- экран «Сегодня» ----------
function viewToday(all) {
  const now = nowStr();
  const today = now.slice(0, 10);
  const day = all.filter((l) => l.date === today);
  const cur = day.find((l) => l.startAt <= now && now < l.endAt && !isDone(l));
  const upcoming = day.filter((l) => l.startAt > now && !isDone(l));
  const past = day.filter((l) => l.endAt <= now || isDone(l));
  let html = changesBlock() + partnerCardHTML();
  if (cur) {
    const a = ms(cur.startAt), b = ms(cur.endAt), n = ms(now);
    const pct = Math.min(100, Math.max(0, ((n - a) / (b - a)) * 100));
    html += `<section class="up"><div class="cap">Идёт сейчас, осталось ${dur(Math.ceil((b - n) / 60000))}</div>` +
      lessonHTML(cur) + `<div class="bar"><i style="width:${pct.toFixed(1)}%"></i></div></section>`;
  } else if (upcoming.length) {
    const diff = Math.ceil((ms(upcoming[0].startAt) - ms(now)) / 60000);
    html += `<section class="up"><div class="cap">Следующая пара ${diff <= 1 ? 'сейчас начнётся' : 'через ' + dur(diff)}</div>` +
      lessonHTML(upcoming[0]) + '</section>';
  }
  const rest = cur ? upcoming : upcoming.slice(1);
  if (rest.length) html += '<h2>Потом сегодня</h2>' + rest.map(lessonHTML).join('');
  if (!cur && !upcoming.length) {
    const nxt = all.find((l) => l.startAt > now && !isDone(l));
    html += `<div class="empty"><div class="ttl">${day.length ? 'На сегодня всё' : 'Сегодня пар нет'}</div>` +
      (nxt
        ? `<div class="meta">Дальше: ${WD[dow(nxt.date)]}, ${human(nxt.date)}, ${esc(nxt.start)}, ${esc(nxt.subject)}</div>`
        : '<div class="meta">Больше пар в расписании нет.</div>') + '</div>';
  }
  html += hwListHTML();
  if (past.length) html += `<details class="past"><summary>Прошло сегодня: ${past.length}</summary>${past.map(lessonHTML).join('')}</details>`;
  return html;
}

// ---------- экран «Неделя» ----------
function viewWeek(all) {
  const today = nowStr().slice(0, 10);
  if (!state.weekOf) state.weekOf = mondayOf(state.selDate || today);
  const days = Array.from({ length: 7 }, (_, i) => addDays(state.weekOf, i));
  if (!state.selDate || !days.includes(state.selDate)) state.selDate = days.includes(today) ? today : days[0];
  const has = new Set(all.map((l) => l.date));
  const a = dOf(days[0]), b = dOf(days[6]);
  const rng = a.getUTCMonth() === b.getUTCMonth()
    ? `${a.getUTCDate()}–${b.getUTCDate()} ${MON[a.getUTCMonth()]}`
    : `${a.getUTCDate()} ${MON_S[a.getUTCMonth()]} – ${b.getUTCDate()} ${MON_S[b.getUTCMonth()]}`;
  let html = calSeg() + `<div class="wk"><button data-act="prev" aria-label="Предыдущая неделя">‹</button><span class="rng">${rng}</span>` +
    '<button data-act="next" aria-label="Следующая неделя">›</button></div><div class="days">';
  for (const d of days) {
    html += `<button class="day${d === today ? ' today' : ''}${has.has(d) ? ' has' : ''}" data-act="day" data-date="${d}" aria-pressed="${d === state.selDate}">` +
      `<small>${WD[dow(d)]}</small><b>${dOf(d).getUTCDate()}</b><i class="dot"></i></button>`;
  }
  html += '</div>';
  if (!days.includes(today)) html += '<button class="tolink" data-act="today">К сегодняшнему дню</button>';
  const list = all.filter((l) => l.date === state.selDate);
  html += `<h2>${WD[dow(state.selDate)]}, ${human(state.selDate)}</h2>` + jointBlock(state.selDate);
  html += list.length ? list.map(lessonHTML).join('') : '<div class="empty"><div class="ttl">В этот день пар нет</div></div>';
  return html;
}

// ---------- экран «Месяц» ----------
// Красная точка ставится на день, к которому нужно ДЗ: ближайшая будущая пара предмета с активным ДЗ.
function hwDueDays(all) {
  const now = nowStr();
  const due = new Set();
  for (const [sk, v] of Object.entries(curDoc().hw)) {
    if (v.done) continue;
    const nx = all.find((l) => l.startAt > now && skey(l) === sk && !isDone(l));
    if (nx) due.add(nx.date);
  }
  return due;
}

function viewMonth(all) {
  const today = nowStr().slice(0, 10);
  if (!state.month) state.month = today.slice(0, 7);
  const [y, m] = state.month.split('-').map(Number);
  const lead = (dow(state.month + '-01') + 6) % 7;
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const count = new Map();
  for (const l of all) if (l.date.slice(0, 7) === state.month) count.set(l.date, (count.get(l.date) || 0) + 1);
  const due = hwDueDays(all);
  if (state.calSel && state.calSel.slice(0, 7) !== state.month) state.calSel = null;
  if (!state.calSel && today.slice(0, 7) === state.month) state.calSel = today;
  let html = calSeg() + `<div class="wk"><button data-act="mprev" aria-label="Предыдущий месяц">‹</button><span class="rng">${MON_N[m - 1]} ${y}</span>` +
    '<button data-act="mnext" aria-label="Следующий месяц">›</button></div><div class="cal">';
  ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].forEach((w) => { html += `<div class="wd">${w}</div>`; });
  for (let i = 0; i < lead; i++) html += '<span class="cell out"></span>';
  for (let d = 1; d <= dim; d++) {
    const ds = `${state.month}-${pad(d)}`;
    const n = count.get(ds) || 0;
    const dueHere = due.has(ds);
    const label = `${d} ${MON[m - 1]}, ${n ? 'пар: ' + n : 'пар нет'}${dueHere ? ', нужно ДЗ' : ''}`;
    html += `<button class="cell${n ? ' has' : ''}${ds === today ? ' today' : ''}" data-act="cell" data-date="${ds}" aria-pressed="${ds === state.calSel}" aria-label="${label}">` +
      `${d}${dueHere ? '<i class="rd"></i>' : ''}</button>`;
  }
  html += '</div>';
  if (state.month !== today.slice(0, 7)) html += '<button class="tolink" data-act="mtoday">К текущему месяцу</button>';
  html += '<div class="ro">Красная точка: к этому дню нужно ДЗ</div>';
  if (state.calSel) {
    const list = all.filter((l) => l.date === state.calSel);
    html += `<h2>${WD[dow(state.calSel)]}, ${human(state.calSel)}</h2>` + jointBlock(state.calSel);
    html += list.length ? list.map(lessonHTML).join('') : '<div class="empty"><div class="ttl">В этот день пар нет</div></div>';
  } else {
    html += '<h2>Выбери день</h2>';
  }
  return html;
}

// ---------- экран «Поиск» ----------
const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е');
const haystack = (l) => norm([l.subject, l.teacher, l.room, l.kind]
  .concat((l.variants || []).reduce((a, v) => a.concat([v.teacher, v.room]), [])).join(' '));

function resultsHTML(all) {
  const today = nowStr().slice(0, 10);
  const doc = curDoc();
  const toks = norm(state.q).split(/\s+/).filter(Boolean);
  const list = all.filter((l) => {
    if (!state.past && l.date < today) return false;
    if (state.kind !== 'all' && l.kind !== state.kind) return false;
    if (state.onlyHw) { const h = doc.hw[skey(l)]; if (!h || h.done) return false; }
    const hay = haystack(l);
    return toks.every((t) => hay.includes(t));
  });
  if (!list.length) return '<div class="empty"><div class="ttl">Ничего не найдено</div><div class="meta">Попробуй другое слово или сними фильтры.</div></div>';
  const shown = list.slice(0, state.limit);
  let html = `<div class="count">Найдено пар: ${list.length}</div>`;
  let lastDate = '';
  for (const l of shown) {
    if (l.date !== lastDate) { html += `<h2>${WD[dow(l.date)]}, ${human(l.date)}</h2>`; lastDate = l.date; }
    html += lessonHTML(l);
  }
  if (list.length > shown.length) html += `<button class="more" data-act="more">Показать ещё</button>`;
  return html;
}

function viewSearch(all) {
  const kinds = [['all', 'Все'], ['лек', 'Лекции'], ['пр', 'Практики'], ['лаб', 'Лабы']];
  return `<input id="q" class="q" type="search" placeholder="Предмет, преподаватель, аудитория" autocomplete="off" enterkeyhint="search" value="${esc(state.q)}">` +
    '<div class="chips">' +
    kinds.map(([v, t]) => `<button class="chip" data-act="kind" data-v="${v}" aria-pressed="${state.kind === v}">${t}</button>`).join('') +
    `<button class="chip" data-act="tgl" data-v="onlyHw" aria-pressed="${state.onlyHw}">С ДЗ</button>` +
    `<button class="chip" data-act="tgl" data-v="past" aria-pressed="${state.past}">И прошедшие</button></div>` +
    `<div id="results">${resultsHTML(all)}</div>`;
}

// ---------- «Предметы»: что на носу, по ближайшему занятию ----------
function viewSubjects(all) {
  const now = nowStr();
  const today = now.slice(0, 10);
  const doc = curDoc();
  const subj = new Map();
  for (const l of all) {
    const k = skey(l);
    if (!subj.has(k)) subj.set(k, { k, name: l.subject, next: null, left: 0 });
    const x = subj.get(k);
    if (l.endAt > now && !isDone(l)) { x.left += 1; if (!x.next) x.next = l; }
  }
  if (!subj.size) return calSeg() + '<div class="empty"><div class="ttl">Расписание пока пустое</div></div>';
  const list = [...subj.values()];
  const byName = (a, b) => a.name.localeCompare(b.name, 'ru');
  const soon = list.filter((x) => x.next).sort((a, b) => (a.next.startAt < b.next.startAt ? -1 : a.next.startAt > b.next.startAt ? 1 : byName(a, b)));
  const gone = list.filter((x) => !x.next).sort(byName);
  const dayN = (d) => Math.round((dOf(d) - dOf(today)) / 864e5);
  let html = calSeg();
  if (!soon.length) html += '<div class="empty"><div class="ttl">Ближайших занятий нет</div></div>';
  else {
    html += `<h2>Ближайшие занятия по предметам: ${soon.length}</h2>` + soon.map((x) => {
      const l = x.next;
      const n = dayN(l.date);
      const top = n === 0 ? 'Сегодня' : n === 1 ? 'Завтра' : `${WD[dow(l.date)]}, ${human(l.date)}`;
      const sub = n === 0 && l.startAt <= now ? 'идёт сейчас' : n >= 2 ? `через ${n} ${plural(n, ['день', 'дня', 'дней'])}` : '';
      const kind = l.kind ? `<span class="badge k-${KIND_CLS[l.kind] || 'other'}">${esc(l.kind)}</span>` : '';
      const chg = changeFor(l);
      const chgB = chg ? `<span class="badge k-chg">${{ moved: 'перенесена', changed: 'изменено', added: 'новая' }[chg.type]}</span>` : '';
      const own = l.custom ? '<span class="badge k-own">своя</span>' : '';
      const col = colorOf(x.k);
      const hw = doc.hw[x.k];
      const pn = pairNo(l);
      return `<article class="subjrow${col ? ' colored' : ''}"${col ? ` style="--c:${col}"` : ''} tabindex="0" role="button" data-act="open" data-k="${esc(lkey(l))}">` +
        `<div class="rl"><div class="sname">${kind}${chgB}${own}${esc(x.name)}</div><div class="when"><b>${top}</b>${sub ? `<span>${sub}</span>` : ''}</div></div>` +
        `<div class="meta">${pn ? pn + ' пара, ' : ''}${esc(l.start)}–${esc(l.end)}${esc(roomBit(l))}</div>` +
        (hw && !hw.done ? `<div class="hw"><i class="rd"></i><span>${esc(hw.text)}</span></div>` : '') +
        `<div class="meta">Осталось занятий: ${x.left}</div></article>`;
    }).join('');
  }
  if (gone.length) {
    html += `<details class="past"><summary>Занятий больше нет: ${gone.length}</summary>` + gone.map((x) => {
      const col = colorOf(x.k);
      return `<div class="subj${col ? ' colored' : ''}"${col ? ` style="--c:${col}"` : ''}><div class="rl"><b>${esc(x.name)}</b></div></div>`;
    }).join('') + '</details>';
  }
  return html;
}

// ---------- экран «Итоги» ----------

function viewStats(all) {
  if (!all.length) return '<div class="empty"><div class="ttl">Пока нет пар для статистики</div></div>';
  const now = nowStr();
  const today = now.slice(0, 10);
  const doc = curDoc();
  const total = all.length;
  const passed = all.filter((l) => l.endAt <= now).length;
  const pct = Math.round((passed / total) * 100);
  const marked = all.filter((l) => doc.done[lkey(l)]).length;

  // прогресс
  let html = '<h2>Прогресс семестра</h2><div class="stat">' +
    `<div class="big">${pct}%</div><div class="bar thick"><i style="width:${pct}%"></i></div>` +
    `<div class="meta">Пройдено пар: ${passed} из ${total}. По расписанию с ${human(all[0].date)} по ${human(all[all.length - 1].date)}.` +
    ` Отмечено вручную: ${marked}.</div></div>`;

  // по предметам
  const subj = new Map();
  for (const l of all) {
    const k = skey(l);
    if (!subj.has(k)) subj.set(k, { name: l.subject, total: 0, passed: 0, kinds: {} });
    const x = subj.get(k);
    x.total += 1;
    if (l.endAt <= now) x.passed += 1;
    const kd = l.kind || 'другое';
    x.kinds[kd] = (x.kinds[kd] || 0) + 1;
  }
  const rows = [...subj.entries()].sort((a, b) => b[1].total - a[1].total || a[1].name.localeCompare(b[1].name, 'ru'));
  html += '<h2>По предметам</h2>' + rows.map(([k, x]) => {
    const col = colorOf(k);
    const w = Math.round((x.passed / x.total) * 100);
    return `<div class="subj${col ? ' colored' : ''}"${col ? ` style="--c:${col}"` : ''}>` +
      `<div class="rl"><b>${esc(x.name)}</b><span>${x.passed} из ${x.total}</span></div>` +
      `<div class="bar"><i style="width:${w}%"></i></div>` +
      `<div class="meta">${Object.entries(x.kinds).map(([kd, n]) => `${esc(kd)} ${n}`).join(', ')}</div></div>`;
  }).join('');

  // ДЗ
  const hwAll = Object.entries(doc.hw);
  const active = hwAll.filter(([, v]) => !v.done).map(([k, v]) => {
    const nx = all.find((l) => l.startAt > now && skey(l) === k && !isDone(l));
    return { k, name: v.name || k, text: v.text, due: nx ? nx.date : null };
  }).sort((a, b) => (a.due || '9999') < (b.due || '9999') ? -1 : (a.due || '9999') > (b.due || '9999') ? 1 : 0);
  html += '<h2>ДЗ</h2><div class="tiles">' +
    `<div class="tile"><b>${active.length}</b><span>активных</span></div>` +
    `<div class="tile"><b>${hwAll.length - active.length}</b><span>выполнено</span></div></div>`;
  html += active.map((a) => {
    const col = colorOf(a.k);
    return `<button class="hwitem${col ? ' colored' : ''}"${col ? ` style="--c:${col}"` : ''} data-act="hw" data-sk="${esc(a.k)}">` +
      `<b>${esc(a.name)}</b><span>${esc(a.text)}</span>` +
      `<span class="due">${a.due ? 'Сдать к ' + WD[dow(a.due)] + ', ' + human(a.due) : 'Ближайших пар по предмету нет'}</span></button>`;
  }).join('');

  // нагрузка
  const days = new Map();
  for (const l of all) {
    let d = days.get(l.date);
    if (!d) { d = { date: l.date, n: 0, first: l.start, last: l.end }; days.set(l.date, d); }
    d.n += 1;
    if (l.start < d.first) d.first = l.start;
    if (l.end > d.last) d.last = l.end;
  }
  const span = (d) => toMin(d.last) - toMin(d.first);
  const top = [...days.values()].filter((d) => d.date >= today)
    .sort((a, b) => b.n - a.n || span(b) - span(a) || (a.date < b.date ? -1 : 1)).slice(0, 5);
  if (top.length) {
    const maxN = top[0].n;
    html += '<h2>Самые загруженные дни впереди</h2>' + top.map((d) =>
      `<div class="dayrow"><div class="rl"><b>${WD[dow(d.date)]}, ${human(d.date)}</b><span>пар: ${d.n}</span></div>` +
      `<div class="bar"><i style="width:${Math.round((d.n / maxN) * 100)}%"></i></div>` +
      `<div class="meta">${esc(d.first)}–${esc(d.last)}</div></div>`).join('');
  }
  const byDow = [0, 0, 0, 0, 0, 0, 0];
  for (const l of all) byDow[dow(l.date)] += 1;
  const order = [1, 2, 3, 4, 5, 6, 0].filter((i, n) => n < 6 || byDow[i] > 0);
  const maxD = Math.max.apply(null, order.map((i) => byDow[i])) || 1;
  html += '<h2>Всего пар по дням недели</h2>' + order.map((i) =>
    `<div class="dayrow"><div class="rl"><b>${WD[i]}</b><span>${byDow[i]}</span></div>` +
    `<div class="bar"><i style="width:${Math.round((byDow[i] / maxD) * 100)}%"></i></div></div>`).join('');
  return html;
}
