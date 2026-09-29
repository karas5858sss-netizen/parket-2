// js/app.js — Сборка экрана (render), обработка нажатий, таймеры, запуск.
// Нужны: все остальные. Файлы общие по области видимости (обычные скрипты), порядок подключения в index.html важен.
(window.PARTS = window.PARTS || []).push('app');

// ---------- общий рендер ----------
function render() {
  if (window.APP_BROKEN) return;   // не хватает файлов приложения, см. защиту в index.html
  const app = document.getElementById('app');
  const openStates = [...app.querySelectorAll('details')].map((d) => d.open);
  const ae = document.activeElement;
  const keepQ = ae && ae.id === 'q' ? { s: ae.selectionStart, e: ae.selectionEnd } : null;
  document.documentElement.dataset.profile = state.profile;
  const d = state.data[state.profile];
  const sw = ['me', 'her'].map((p) => {
    const g = state.data[p] && state.data[p].group;
    return `<button data-act="profile" data-p="${p}" aria-pressed="${p === state.profile}">${LABEL[p]}<small>${esc(g || '')}</small></button>`;
  }).join('');
  let body = syncNote();
  if (state.who && state.who !== state.profile) body += `<div class="ro">Расписание ${esc(LABEL[state.profile])}: только просмотр</div>`;
  if (state.err[state.profile]) {
    body += `<div class="err">${d ? 'Не удалось обновить, показаны сохранённые данные.' : 'Не удалось загрузить расписание.'} (${esc(state.err[state.profile])})` +
      '<br><button data-act="refresh">Повторить</button></div>';
  }
  if (d) {
    body += { today: viewToday, week: viewWeek, month: viewMonth, subjects: viewSubjects, search: viewSearch, stats: viewStats }[state.tab](allLessons());
    const t = d.fetchedAt
      ? new Date(d.fetchedAt).toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' })
      : '';
    const partial = d.errors && d.errors.length ? ' Часть недель не загрузилась.' : '';
    const pend = hasPending() ? ' Есть несохранённые изменения.' : '';
    body += `<div class="status"><span>${state.loading[state.profile] ? 'Обновляю…' : 'Обновлено в ' + t + '.' + partial + pend}</span>` +
      '<button data-act="refresh">Обновить</button></div>';
  } else if (state.loading[state.profile]) {
    body += '<div class="empty"><div class="ttl">Загружаю расписание…</div></div>';
  }
  const tabs = [['today', 'Сегодня'], ['cal', 'Календарь'], ['search', 'Поиск'], ['stats', 'Итоги']].map(([k, t]) =>
    `<button data-act="tab" data-tab="${k}" aria-pressed="${k === (state.tab === 'week' || state.tab === 'month' || state.tab === 'subjects' ? 'cal' : state.tab)}">${t}</button>`).join('');
  app.innerHTML = `<div class="top"><div class="switch">${sw}</div><button class="themebtn" data-act="theme" aria-label="Настройки">Настройки</button><button class="plansbtn" data-act="plans" aria-label="Совместные планы">🍿 Планы</button></div>${body}<nav class="tabs">${tabs}</nav>${canEdit() && d && state.tab !== 'stats' ? '<button class="fab" data-act="add" aria-label="Добавить свою пару">+</button>' : ''}`;
  app.querySelectorAll('details').forEach((el, i) => { if (openStates[i]) el.open = true; });
  if (keepQ) { const q = document.getElementById('q'); if (q) { q.focus(); try { q.setSelectionRange(keepQ.s, keepQ.e); } catch (x) {} } }
}

// ---------- события ----------
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  if (act === 'open') {
    if (e.target.closest('details')) return;
    const all = allLessons();
    const l = all.find((x) => lkey(x) === b.dataset.k);
    if (l) openSheet({ sk: skey(l), name: l.subject, lesson: l });
    return;
  }
  if (act === 'hw') {
    const h = curDoc().hw[b.dataset.sk];
    const tabIdx = b.dataset.tab ? Number(b.dataset.tab) : 0;
    openSheet({ sk: b.dataset.sk, name: h ? h.name : '', lesson: null, tabIdx });
    return;
  }
  if (act === 'add') { if (canEdit()) openForm(null, null); return; }
  if (act === 'c-edit' && sheetCtx && sheetCtx.lesson && sheetCtx.lesson.custom) {
    const l = sheetCtx.lesson;
    const owner = l.owner || state.profile;
    const ownerDoc = state.docs && state.docs[owner];
    const id = l.cid;
    const item = (ownerDoc && ownerDoc.custom && ownerDoc.custom[id]) || curDoc().custom[id];
    if (item) openForm(id, item);
    return;
  }
  if (act === 'c-skip' && sheetCtx && sheetCtx.lesson && sheetCtx.lesson.custom) {
    const l = sheetCtx.lesson;
    const owner = l.owner || state.profile;
    const ownerDoc = state.docs && state.docs[owner];
    const old = (ownerDoc && ownerDoc.custom && ownerDoc.custom[l.cid]) || curDoc().custom[l.cid];
    if (old && owner === state.who) {
      const skip = Array.from(new Set((old.skip || []).concat(l.date)));
      save({ custom: { [l.cid]: Object.assign({}, old, { skip }) } });
      closeSheet();
      toast('Дата пропущена', () => save({ custom: { [l.cid]: old } }));
    }
    return;
  }
  if (act === 'c-del' && sheetCtx && sheetCtx.lesson && sheetCtx.lesson.custom) {
    const l = sheetCtx.lesson;
    const owner = l.owner || state.profile;
    const ownerDoc = state.docs && state.docs[owner];
    const old = (ownerDoc && ownerDoc.custom && ownerDoc.custom[l.cid]) || curDoc().custom[l.cid];
    if (!old || owner !== state.who) return;
    const msg = old.until ? 'Удалить всю серию «' + old.title + '»?' : 'Удалить «' + old.title + '»?';
    confirmTG(msg, () => {
      save({ custom: { [l.cid]: null } });
      closeSheet();
      toast('Удалено', () => save({ custom: { [l.cid]: old } }));
    });
    return;
  }
  if (act === 'f-both' && formCtx) {
    formCtx.both = b.dataset.v === '1';
    document.querySelectorAll('#f-both-chips .chip').forEach((el) => el.setAttribute('aria-pressed', String(el.dataset.v === b.dataset.v)));
    return;
  }
  if (act === 'f-kind' && formCtx) {
    formCtx.kind = b.dataset.v;
    document.querySelectorAll('#f-kinds .chip').forEach((el) => el.setAttribute('aria-pressed', String(el.dataset.v === formCtx.kind)));
    return;
  }
  if (act === 'f-repeat' && formCtx) {
    formCtx.weekly = b.dataset.v === '1';
    document.querySelectorAll('#f-repeats .chip').forEach((el) => el.setAttribute('aria-pressed', String(el.dataset.v === b.dataset.v)));
    document.getElementById('f-until-wrap').hidden = !formCtx.weekly;
    const u = document.getElementById('f-until');
    const dt = document.getElementById('f-date').value;
    if (formCtx.weekly && !u.value && dt) u.value = addDays(dt, 56);   // по умолчанию 8 недель
    return;
  }
  if (act === 'f-slot' && formCtx) {
    const sl = (SLOTS[state.profile] || [])[Number(b.dataset.v)];
    if (sl) { document.getElementById('f-start').value = sl[0]; document.getElementById('f-end').value = sl[1]; refreshSlotChips(); }
    return;
  }
  if (act === 'f-save' && formCtx) { saveForm(); return; }
  if (act === 'theme') { openSettings(); return; }
  if (act === 'notify-set') {
    savePref({ prefs: { notify: b.dataset.v === '1' } });
    document.querySelectorAll('#notifychips .chip').forEach((el) => el.setAttribute('aria-pressed', String((el.dataset.v === '1') === notifyOn())));
    return;
  }
  if (act === 'notify-test') { sendTestNotify(); return; }
  if (act === 'notify-upcoming-test') { sendTestUpcomingNotify(); return; }
  if (act === 'theme-set') {
    store.set('parket.theme', b.dataset.v);
    applyTheme();
    document.querySelectorAll('#themechips .chip').forEach((el) => el.setAttribute('aria-pressed', String(el.dataset.v === b.dataset.v)));
    return;
  }
  if (act === 'chg-read') {
    const latest = relevantChanges(state.profile).reduce((m, e) => (e.t > m ? e.t : m), '');
    if (latest) savePref({ prefs: { seen: { [state.profile]: latest } } });
    return;
  }
  if (act === 'sheet-close') { closeSheet(); return; }
  if (act === 'color' && sheetCtx) {
    const i = Number(b.dataset.i);
    save({ colors: { [sheetCtx.sk]: i >= 0 ? i : null } });
    const cur = curDoc().colors[sheetCtx.sk];
    document.querySelectorAll('#swatches .sw').forEach((el) => {
      const n = Number(el.dataset.i);
      el.setAttribute('aria-pressed', String(n < 0 ? !Number.isInteger(cur) : n === cur));
    });
    return;
  }
  if (act === 'hw-tab' && sheetCtx) {
    const ta = document.getElementById('hwtext');
    if (ta && sheetCtx.items && sheetCtx.items[sheetCtx.curTab]) sheetCtx.items[sheetCtx.curTab].text = ta.value;
    sheetCtx.curTab = Number(b.dataset.i);
    renderSheetContent();
    return;
  }
  if (act === 'hw-add' && sheetCtx) {
    const ta = document.getElementById('hwtext');
    if (ta && sheetCtx.items && sheetCtx.items[sheetCtx.curTab]) sheetCtx.items[sheetCtx.curTab].text = ta.value;
    sheetCtx.items.push({ id: newId(), text: '', done: false, t: Date.now() });
    sheetCtx.curTab = sheetCtx.items.length - 1;
    renderSheetContent();
    const nta = document.getElementById('hwtext');
    if (nta) nta.focus();
    return;
  }
  if (act === 'hw-save' && sheetCtx) {
    const ta = document.getElementById('hwtext');
    if (ta && sheetCtx.items && sheetCtx.items[sheetCtx.curTab]) sheetCtx.items[sheetCtx.curTab].text = ta.value.trim().slice(0, 300);
    saveHw(sheetCtx.sk, sheetCtx.name, sheetCtx.items);
    closeSheet();
    return;
  }
  if (act === 'hw-toggle' && sheetCtx) {
    const ta = document.getElementById('hwtext');
    if (ta && sheetCtx.items && sheetCtx.items[sheetCtx.curTab]) sheetCtx.items[sheetCtx.curTab].text = ta.value.trim().slice(0, 300);
    const cur = sheetCtx.items && sheetCtx.items[sheetCtx.curTab];
    if (cur) cur.done = !cur.done;
    saveHw(sheetCtx.sk, sheetCtx.name, sheetCtx.items);
    closeSheet();
    return;
  }
  if (act === 'hw-del-tab' && sheetCtx) {
    if (e.stopPropagation) e.stopPropagation();
    const i = Number(b.dataset.i);
    if (sheetCtx.items && sheetCtx.items.length > 1) {
      sheetCtx.items.splice(i, 1);
      sheetCtx.curTab = Math.max(0, Math.min(sheetCtx.curTab, sheetCtx.items.length - 1));
      saveHw(sheetCtx.sk, sheetCtx.name, sheetCtx.items);
      renderSheetContent();
    }
    return;
  }
  if (act === 'hw-del' && sheetCtx) {
    if (sheetCtx.items && sheetCtx.items.length > 1) {
      sheetCtx.items.splice(sheetCtx.curTab, 1);
      sheetCtx.curTab = Math.max(0, sheetCtx.curTab - 1);
      saveHw(sheetCtx.sk, sheetCtx.name, sheetCtx.items);
      renderSheetContent();
    } else {
      save({ hw: { [sheetCtx.sk]: null } });
      closeSheet();
    }
    return;
  }
  if (act === 'lesson-done' && sheetCtx && sheetCtx.lesson) {
    const l = sheetCtx.lesson;
    const k = lkey(l);
    if (curDoc().done[k]) { save({ done: { [k]: null } }); closeSheet(); return; }
    confirmTG('Отметить пару «' + l.subject + '» пройденной?', () => {
      save({ done: { [k]: true } });
      closeSheet();
      toast('Пара отмечена пройденной', () => save({ done: { [k]: null } }));
    });
    return;
  }
  if (act === 'undo') { const f = undoFn; hideToast(); if (f) f(); return; }
  if (act === 'profile' && b.dataset.p !== state.profile) {
    state.userPicked = true;
    state.profile = b.dataset.p;
    store.set('parket.profile', state.profile);
    load(state.profile);
  } else if (act === 'tab') {
    let tb = b.dataset.tab;
    if (tb === 'cal') tb = state.calMode;                       // «Календарь» открывается в последнем масштабе
    if (tb === 'week' || tb === 'month' || tb === 'subjects') {
      state.calMode = tb;
      store.set('parket.calmode', tb);
      if (tb === 'month' && state.selDate) {
        state.month = state.selDate.slice(0, 7);
        state.calSel = state.selDate;
      } else if (tb === 'week' && state.calSel) {
        state.selDate = state.calSel;
        state.weekOf = mondayOf(state.calSel);
      }
    }
    state.tab = tb; store.set('parket.tab', tb); render();
  } else if (act === 'prev' || act === 'next') {
    state.weekOf = addDays(state.weekOf, act === 'next' ? 7 : -7);
    if (state.selDate) state.selDate = addDays(state.selDate, act === 'next' ? 7 : -7);
    render();
  } else if (act === 'day') {
    state.selDate = b.dataset.date;
    state.calSel = b.dataset.date;
    state.month = b.dataset.date.slice(0, 7);
    render();
  } else if (act === 'today') {
    const td = nowStr().slice(0, 10);
    state.weekOf = mondayOf(td); state.selDate = td;
    state.calSel = td; state.month = td.slice(0, 7);
    render();
  } else if (act === 'mprev' || act === 'mnext') {
    const [yy, mm] = state.month.split('-').map(Number);
    const nd = new Date(Date.UTC(yy, mm - 1 + (act === 'mnext' ? 1 : -1), 1));
    state.month = nd.getUTCFullYear() + '-' + pad(nd.getUTCMonth() + 1);
    render();
  } else if (act === 'mtoday') {
    const td = nowStr().slice(0, 10);
    state.month = td.slice(0, 7); state.calSel = td;
    state.selDate = td; state.weekOf = mondayOf(td);
    render();
  } else if (act === 'cell') {
    state.calSel = b.dataset.date;
    state.selDate = b.dataset.date;
    state.weekOf = mondayOf(b.dataset.date);
    render();
  } else if (act === 'kind') {
    state.kind = b.dataset.v; state.limit = 50; render();
  } else if (act === 'tgl') {
    state[b.dataset.v] = !state[b.dataset.v]; state.limit = 50; render();
  } else if (act === 'more') {
    state.limit += 50; render();
  } else if (act === 'refresh') {
    load(state.profile);
    loadQuiet(otherOf(state.profile));
    loadChanges().then(render);
    loadState().then(() => { render(); flush(); });
  } else if (act === 'plans') {
    openPlansSheet();
  } else if (act === 'plans-cat') {
    openPlansSheet(b.dataset.c);
  } else if (act === 'wish-toggle') {
    const wid = b.dataset.id;
    const auth = b.dataset.auth;
    const isDone = b.dataset.done === '1';
    const curW = (state.docs[auth] && state.docs[auth].wishes && state.docs[auth].wishes[wid]) || {};
    saveWish(wid, Object.assign({}, curW, { done: !isDone }), auth);
    renderPlansSheet();
  } else if (act === 'wish-del') {
    saveWish(b.dataset.id, null, b.dataset.auth);
    renderPlansSheet();
  } else if (act === 'wish-add') {
    const inp = document.getElementById('wish-in');
    const csel = document.getElementById('wish-cat');
    const txt = inp ? inp.value.trim() : '';
    const cat = csel ? csel.value : 'other';
    if (txt) {
      saveWish(newId(), { text: txt, cat, done: false });
      renderPlansSheet();
    }
  } else if (act === 'wish-sched') {
    const txt = b.dataset.text;
    closeSheet();
    openForm(null, { title: txt, both: true });
  } else if (act === 'status-pick') {
    saveStatus({ text: b.dataset.val });
  } else if (act === 'status-clear') {
    saveStatus(null);
    closeSheet();
  } else if (act === 'status-custom') {
    openStatusSheet();
  } else if (act === 'status-save-custom') {
    const inp = document.getElementById('status-in');
    const val = inp ? inp.value.trim() : '';
    if (val) saveStatus({ text: val }); else saveStatus(null);
    closeSheet();
  }
  if (tg && tg.HapticFeedback) { try { tg.HapticFeedback.selectionChanged(); } catch (x) {} }
});

let touchStartX = 0;
let touchStartY = 0;
let touchStartTime = 0;

document.addEventListener('touchstart', (e) => {
  if (!e.touches || e.touches.length !== 1) return;
  touchStartX = e.touches[0].clientX;
  touchStartY = e.touches[0].clientY;
  touchStartTime = Date.now();
}, { passive: true });

document.addEventListener('touchend', (e) => {
  if (!e.changedTouches || e.changedTouches.length !== 1) return;
  const sh = document.getElementById('sheet');
  if (sh && sh.children.length > 0) return;
  if (e.target && typeof e.target.closest === 'function' && e.target.closest('input, textarea, select')) return;

  const dx = e.changedTouches[0].clientX - touchStartX;
  const dy = e.changedTouches[0].clientY - touchStartY;
  const dt = Date.now() - touchStartTime;

  if (Math.abs(dx) >= 50 && Math.abs(dx) > 1.5 * Math.abs(dy) && dt < 600) {
    const isLeft = dx < 0;

    if (state.tab === 'week') {
      const today = nowStr().slice(0, 10);
      const cur = state.selDate || today;
      state.selDate = addDays(cur, isLeft ? 1 : -1);
      state.weekOf = mondayOf(state.selDate);
      if (tg && tg.HapticFeedback) { try { tg.HapticFeedback.selectionChanged(); } catch (err) {} }
      render();
    } else if (state.tab === 'month') {
      const today = nowStr().slice(0, 10);
      const curM = state.month || today.slice(0, 7);
      const [yy, mm] = curM.split('-').map(Number);
      const nd = new Date(Date.UTC(yy, mm - 1 + (isLeft ? 1 : -1), 1));
      state.month = nd.getUTCFullYear() + '-' + pad(nd.getUTCMonth() + 1);
      state.calSel = null;
      if (tg && tg.HapticFeedback) { try { tg.HapticFeedback.selectionChanged(); } catch (err) {} }
      render();
    }
  }
}, { passive: true });

document.addEventListener('input', (e) => {
  if (e.target.id === 'f-start' || e.target.id === 'f-end') { refreshSlotChips(); return; }
  if (e.target.id !== 'q') return;
  state.q = e.target.value; state.limit = 50;
  const r = document.getElementById('results');
  if (r) r.innerHTML = resultsHTML(allLessons());
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeSheet(); return; }
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('.lesson[data-act="open"], .subjrow[data-act="open"]')) {
    e.preventDefault();
    e.target.click();
  }
});

// Именованные интервалы — чтобы не путать «раз в 30 сек» и «раз в 5 мин» при следующей правке.
const TIMERS = {
  CLOCK_MS: 30 * 1000,           // на «Сегодня» обновляем таймер пары и пробуем досдать очередь
  SCHEDULE_STALE_MS: 15 * 60 * 1000, // расписание старше этого — подгружаем заново при возврате в приложение
  STATE_STALE_MS: 60 * 1000,         // то же самое для ДЗ/отметок/настроек
  CHANGES_STALE_MS: 5 * 60 * 1000,   // то же самое для журнала «что изменилось»
};

function updateLiveToday() {
  if (state.tab !== 'today' || !state.data[state.profile]) return;
  const now = nowStr();
  const today = now.slice(0, 10);
  const all = allLessons();
  const day = all.filter((l) => l.date === today);
  const cur = day.find((l) => l.startAt <= now && now < l.endAt && !isDone(l));
  const upcoming = day.filter((l) => l.startAt > now && !isDone(l));
  const upBox = document.querySelector('.up');
  if (!upBox) {
    if (cur || upcoming.length) render();
    return;
  }
  if (cur) {
    const a = ms(cur.startAt), b = ms(cur.endAt), n = ms(now);
    const pct = Math.min(100, Math.max(0, ((n - a) / (b - a)) * 100));
    const cap = upBox.querySelector('.cap');
    const bar = upBox.querySelector('.bar i');
    if (cap) cap.textContent = `Идёт сейчас, осталось ${dur(Math.ceil((b - n) / 60000))}`;
    if (bar) bar.style.width = `${pct.toFixed(1)}%`;
  } else {
    render();
  }
}

setInterval(() => {
  if (document.hidden) return;
  if (hasPending()) flush();
  updateLiveToday();
}, TIMERS.CLOCK_MS);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  const d = state.data[state.profile];
  if (d && Date.now() - Date.parse(d.fetchedAt) > TIMERS.SCHEDULE_STALE_MS) load(state.profile); else render();
  if (Date.now() - lastStateAt > TIMERS.STATE_STALE_MS) loadState().then(() => { render(); flush(); });
  if (Date.now() - lastChangesAt > TIMERS.CHANGES_STALE_MS) loadChanges().then(render);
});

// ---------- старт ----------
render();
load(state.profile);
loadQuiet(otherOf(state.profile));
loadState().then(() => {
  if (state.who && !state.userPicked && state.profile !== state.who) {
    state.profile = state.who;
    load(state.profile);
    loadQuiet(otherOf(state.profile));
  } else {
    render();
  }
  flush();
  loadChanges().then(render);
});
