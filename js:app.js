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
  if (state.err) {
    body += `<div class="err">${d ? 'Не удалось обновить, показаны сохранённые данные.' : 'Не удалось загрузить расписание.'} (${esc(state.err)})` +
      '<br><button data-act="refresh">Повторить</button></div>';
  }
  if (d) {
    body += { today: viewToday, week: viewWeek, month: viewMonth, subjects: viewSubjects, search: viewSearch, stats: viewStats }[state.tab](allLessons());
    const t = d.fetchedAt
      ? new Date(d.fetchedAt).toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' })
      : '';
    const partial = d.errors && d.errors.length ? ' Часть недель не загрузилась.' : '';
    const pend = hasPending() ? ' Есть несохранённые изменения.' : '';
    body += `<div class="status"><span>${state.loading ? 'Обновляю…' : 'Обновлено в ' + t + '.' + partial + pend}</span>` +
      '<button data-act="refresh">Обновить</button></div>';
  } else if (state.loading) {
    body += '<div class="empty"><div class="ttl">Загружаю расписание…</div></div>';
  }
  const tabs = [['today', 'Сегодня'], ['cal', 'Календарь'], ['search', 'Поиск'], ['stats', 'Итоги']].map(([k, t]) =>
    `<button data-act="tab" data-tab="${k}" aria-pressed="${k === (state.tab === 'week' || state.tab === 'month' || state.tab === 'subjects' ? 'cal' : state.tab)}">${t}</button>`).join('');
  app.innerHTML = `<div class="top"><div class="switch">${sw}</div><button class="themebtn" data-act="theme" aria-label="Настройки">Настройки</button></div>${body}<nav class="tabs">${tabs}</nav>${canEdit() && d && state.tab !== 'stats' ? '<button class="fab" data-act="add" aria-label="Добавить свою пару">+</button>' : ''}`;
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
    openSheet({ sk: b.dataset.sk, name: h ? h.name : '', lesson: null });
    return;
  }
  if (act === 'add') { if (canEdit()) openForm(null, null); return; }
  if (act === 'c-edit' && sheetCtx && sheetCtx.lesson && sheetCtx.lesson.custom) {
    const id = sheetCtx.lesson.cid;
    openForm(id, curDoc().custom[id]);
    return;
  }
  if (act === 'c-skip' && sheetCtx && sheetCtx.lesson && sheetCtx.lesson.custom) {
    const l = sheetCtx.lesson;
    const old = curDoc().custom[l.cid];
    if (old) {
      const skip = Array.from(new Set((old.skip || []).concat(l.date)));
      save({ custom: { [l.cid]: Object.assign({}, old, { skip }) } });
      closeSheet();
      toast('Дата пропущена', () => save({ custom: { [l.cid]: old } }));
    }
    return;
  }
  if (act === 'c-del' && sheetCtx && sheetCtx.lesson && sheetCtx.lesson.custom) {
    const l = sheetCtx.lesson;
    const old = curDoc().custom[l.cid];
    if (!old) return;
    confirmTG(old.until ? 'Удалить всю серию «' + old.title + '»?' : 'Удалить пару «' + old.title + '»?', () => {
      save({ custom: { [l.cid]: null } });
      closeSheet();
      toast('Пара удалена', () => save({ custom: { [l.cid]: old } }));
    });
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
  if (act === 'hw-save' && sheetCtx) {
    const text = document.getElementById('hwtext').value.trim().slice(0, 100);
    saveHw(sheetCtx.sk, sheetCtx.name, text, false); closeSheet(); return;
  }
  if (act === 'hw-toggle' && sheetCtx) {
    const h = curDoc().hw[sheetCtx.sk];
    if (h) saveHw(sheetCtx.sk, h.name || sheetCtx.name, h.text, !h.done);
    closeSheet(); return;
  }
  if (act === 'hw-del' && sheetCtx) { save({ hw: { [sheetCtx.sk]: null } }); closeSheet(); return; }
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
    state.profile = b.dataset.p; state.weekOf = null; state.selDate = null;
    store.set('parket.profile', state.profile);
    load(state.profile);
  } else if (act === 'tab') {
    let tb = b.dataset.tab;
    if (tb === 'cal') tb = state.calMode;                       // «Календарь» открывается в последнем масштабе
    if (tb === 'week' || tb === 'month' || tb === 'subjects') { state.calMode = tb; store.set('parket.calmode', tb); }
    state.tab = tb; store.set('parket.tab', tb); render();
  } else if (act === 'prev' || act === 'next') {
    state.weekOf = addDays(state.weekOf, act === 'next' ? 7 : -7); state.selDate = null; render();
  } else if (act === 'day') {
    state.selDate = b.dataset.date; render();
  } else if (act === 'today') {
    state.weekOf = null; state.selDate = null; render();
  } else if (act === 'mprev' || act === 'mnext') {
    const [yy, mm] = state.month.split('-').map(Number);
    const nd = new Date(Date.UTC(yy, mm - 1 + (act === 'mnext' ? 1 : -1), 1));
    state.month = nd.getUTCFullYear() + '-' + pad(nd.getUTCMonth() + 1); state.calSel = null; render();
  } else if (act === 'mtoday') {
    state.month = null; state.calSel = null; render();
  } else if (act === 'cell') {
    state.calSel = b.dataset.date; render();
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
  }
  if (tg && tg.HapticFeedback) { try { tg.HapticFeedback.selectionChanged(); } catch (x) {} }
});

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

setInterval(() => {
  if (document.hidden) return;
  if (hasPending()) flush();
  if (state.tab === 'today' && state.data[state.profile]) render();
}, 30000);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  const d = state.data[state.profile];
  if (d && Date.now() - Date.parse(d.fetchedAt) > 15 * 60000) load(state.profile); else render();
  if (Date.now() - lastStateAt > 60000) loadState().then(() => { render(); flush(); });
  if (Date.now() - lastChangesAt > 5 * 60000) loadChanges().then(render);
});

// ---------- старт ----------
render();
load(state.profile);
loadQuiet(otherOf(state.profile));
loadState().then(() => {
  if (state.who && !state.userPicked && state.profile !== state.who) {
    state.profile = state.who; state.weekOf = null; state.selDate = null;
    load(state.profile);
    loadQuiet(otherOf(state.profile));
  } else {
    render();
  }
  flush();
  loadChanges().then(render);
});
