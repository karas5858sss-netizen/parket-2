// js/sheets.js — Нижние листы и формы: ДЗ, настройки, своя пара, «отменить» (тост), подтверждение.
// Нужны: core, state, domain, cards. Файлы общие по области видимости (обычные скрипты), порядок подключения в index.html важен.
(window.PARTS = window.PARTS || []).push('sheets');

// ---------- нижний лист с ДЗ ----------
let sheetCtx = null;
let formCtx = null;
function closeSheet() {
  sheetCtx = null;
  formCtx = null;
  document.getElementById('sheet').innerHTML = '';
  document.body.style.overflow = '';
}
function openSheet(o) {
  const doc = curDoc();
  const hw = doc.hw[o.sk];
  const edit = canEdit();
  const l = o.lesson;
  sheetCtx = o;
  const cc = l && l.custom ? doc.custom[l.cid] : null;
  const own = cc ? `<div class="meta">Своя пара${cc.until ? ', каждую неделю до ' + human(cc.until) : ''}</div>` : '';
  const custBtns = cc && edit
    ? '<button class="btn" data-act="c-edit">Изменить пару</button>' +
      (cc.until ? '<button class="btn" data-act="c-skip">Пропустить только эту дату</button>' : '') +
      `<button class="btn danger" data-act="c-del">${cc.until ? 'Удалить всю серию' : 'Удалить пару'}</button>`
    : '';
  const head = l
    ? `<div class="ttl">${esc(l.subject)}</div><div class="meta">${WD[dow(l.date)]}, ${human(l.date)}, ${esc(l.start)}–${esc(l.end)}${pairNo(l) ? ', ' + pairNo(l) + ' пара' : ''}</div>${own}`
    : `<div class="ttl">${esc(o.name || 'ДЗ')}</div>`;
  let body;
  if (edit) {
    const text = hw ? hw.text : '';
    const cur = doc.colors[o.sk];
    const sws = PALETTE.map(([c, n], i) => `<button class="sw" style="--c:${c}" data-act="color" data-i="${i}" aria-label="${n}" aria-pressed="${cur === i}"></button>`).join('') +
      `<button class="sw none" data-act="color" data-i="-1" aria-label="без цвета" aria-pressed="${!Number.isInteger(cur)}"></button>`;
    body = `<label>ДЗ по предмету <span class="cnt"><span id="cnt">${text.length}</span>/100</span>` +
      `<textarea id="hwtext" rows="3" maxlength="100" placeholder="Что задали">${esc(text)}</textarea></label>` +
      `<label>Цвет предмета</label><div class="swatches" id="swatches">${sws}</div><div class="btns">` +
      '<button class="btn primary" data-act="hw-save">Сохранить</button>' +
      (hw ? `<button class="btn" data-act="hw-toggle">${hw.done ? 'Вернуть в активные' : 'ДЗ выполнено'}</button>` +
            '<button class="btn danger" data-act="hw-del">Удалить ДЗ</button>' : '') +
      (l ? `<button class="btn" data-act="lesson-done">${doc.done[lkey(l)] ? 'Снять отметку «пройдена»' : 'Отметить пару пройденной'}</button>` : '') +
      custBtns + '<button class="btn" data-act="sheet-close">Закрыть</button></div>';
  } else {
    body = '<label>ДЗ по предмету</label><div class="view">' +
      (hw && hw.text ? esc(hw.text) + (hw.done ? '\n(выполнено)' : '') : 'ДЗ нет') + '</div>' +
      '<div class="btns"><button class="btn" data-act="sheet-close">Закрыть</button></div>';
  }
  document.getElementById('sheet').innerHTML =
    `<div class="sh-bg" data-act="sheet-close"></div><div class="sheet" role="dialog" aria-modal="true">${head}${body}</div>`;
  document.body.style.overflow = 'hidden';
  const ta = document.getElementById('hwtext');
  if (ta) ta.addEventListener('input', () => { document.getElementById('cnt').textContent = ta.value.length; });
}

function openSettings() {
  closeSheet();
  const cur = themePref();
  const chips = [['auto', 'Как в Telegram'], ['light', 'Светлая'], ['dark', 'Тёмная']].map(([v, t]) =>
    `<button class="chip" data-act="theme-set" data-v="${v}" aria-pressed="${cur === v}">${t}</button>`).join('');
  let notify;
  if (state.who && tg && tg.initData) {
    const on = notifyOn();
    notify = '<label>Вечернее напоминание в Telegram</label><div class="chips" id="notifychips">' +
      `<button class="chip" data-act="notify-set" data-v="1" aria-pressed="${on}">Включено</button>` +
      `<button class="chip" data-act="notify-set" data-v="0" aria-pressed="${!on}">Выключено</button></div>` +
      '<div class="meta">Каждый вечер около 20:00 по Москве бот присылает: твои пары на завтра, всё активное ДЗ и время занятости второго человека.</div>' +
      '<div class="btns"><button class="btn" id="notify-test" data-act="notify-test">Прислать пример сейчас</button></div>' +
      '<div class="meta" id="notify-status" role="status"></div>';
  } else {
    notify = '<label>Вечернее напоминание в Telegram</label><div class="meta">Работает только внутри Telegram, когда сервер настроен.</div>';
  }
  document.getElementById('sheet').innerHTML =
    '<div class="sh-bg" data-act="sheet-close"></div><div class="sheet" role="dialog" aria-modal="true">' +
    `<div class="ttl">Настройки</div><label>Тема</label><div class="chips" id="themechips">${chips}</div>${notify}` +
    `<div class="meta">Версия сборки: ${BUILD}</div>` +
    '<div class="btns"><button class="btn" data-act="sheet-close">Готово</button></div></div>';
  document.body.style.overflow = 'hidden';
}

async function sendTestNotify() {
  const btn = document.getElementById('notify-test');
  const box = document.getElementById('notify-status');
  if (!btn || !box) return;
  btn.disabled = true;
  box.textContent = 'Отправляю…';
  try {
    const r = await fetch('/api/notify', { method: 'POST', headers: { 'X-Init-Data': tg.initData } });
    const j = await r.json().catch(() => ({}));
    if (r.ok) box.textContent = 'Отправлено, посмотри чат с ботом.';
    else if (/blocked|initiate|chat not found|deactivated/i.test(j.error || '')) box.textContent = 'Бот не может тебе написать. Открой чат с ботом и нажми Start.';
    else if (r.status === 503) box.textContent = 'На сервере не хватает настроек: ' + ((j.missing || []).join(', ') || 'проверь переменные') + '.';
    else box.textContent = 'Не получилось отправить (' + (j.error || 'HTTP ' + r.status) + ').';
  } catch (e) {
    box.textContent = 'Нет связи с сервером.';
  } finally {
    btn.disabled = false;
  }
}

// ---------- форма «Своя пара» ----------
function defaultDate() {
  if (state.tab === 'week' && state.selDate) return state.selDate;
  if (state.tab === 'month' && state.calSel) return state.calSel;
  return nowStr().slice(0, 10);
}
const newId = () => (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)).slice(0, 40);

function openForm(id, c) {
  closeSheet();
  formCtx = { id: id || newId(), kind: c ? c.kind || '' : '', weekly: !!(c && c.until), skip: c && c.skip ? c.skip : [] };
  const v = c || { title: '', date: defaultDate(), start: '', end: '', room: '', teacher: '', until: '' };
  const chips = (act, opts, cur) => opts.map(([val, t]) =>
    `<button class="chip" type="button" data-act="${act}" data-v="${val}" aria-pressed="${cur === val}">${t}</button>`).join('');
  document.getElementById('sheet').innerHTML =
    '<div class="sh-bg" data-act="sheet-close"></div><div class="sheet" role="dialog" aria-modal="true">' +
    `<div class="ttl">${c ? 'Изменить пару' : 'Своя пара'}</div>` +
    `<label>Название<input id="f-title" class="in" maxlength="80" autocomplete="off" value="${esc(v.title)}"></label>` +
    `<label>Тип</label><div class="chips" id="f-kinds">${chips('f-kind', [['', 'Без типа'], ['лек', 'лек'], ['пр', 'пр'], ['лаб', 'лаб']], formCtx.kind)}</div>` +
    `<label>Дата<input id="f-date" class="in" type="date" value="${esc(v.date)}"></label>` +
    `<div class="row2"><label>Начало<input id="f-start" class="in" type="time" value="${esc(v.start)}"></label>` +
    `<label>Конец<input id="f-end" class="in" type="time" value="${esc(v.end)}"></label></div>` +
    '<label>Номер пары (подставит время)</label><div class="chips" id="f-slots">' +
    (SLOTS[state.profile] || []).map(([st, en], i) => `<button class="chip" type="button" data-act="f-slot" data-v="${i}" aria-pressed="${v.start === st && v.end === en}">${i + 1}</button>`).join('') + '</div>' +
    `<label>Аудитория<input id="f-room" class="in" maxlength="40" autocomplete="off" value="${esc(v.room)}"></label>` +
    `<label>Преподаватель<input id="f-teacher" class="in" maxlength="60" autocomplete="off" value="${esc(v.teacher)}"></label>` +
    `<label>Повтор</label><div class="chips" id="f-repeats">${chips('f-repeat', [['0', 'Не повторять'], ['1', 'Каждую неделю']], formCtx.weekly ? '1' : '0')}</div>` +
    `<label id="f-until-wrap"${formCtx.weekly ? '' : ' hidden'}>Повторять до<input id="f-until" class="in" type="date" value="${esc(v.until || '')}"></label>` +
    '<div class="err" id="f-err" hidden></div>' +
    '<div class="btns"><button class="btn primary" data-act="f-save">Сохранить</button><button class="btn" data-act="sheet-close">Отмена</button></div></div>';
  document.body.style.overflow = 'hidden';
}

function refreshSlotChips() {
  const st = document.getElementById('f-start');
  const en = document.getElementById('f-end');
  if (!st || !en) return;
  document.querySelectorAll('#f-slots .chip').forEach((el) => {
    const sl = (SLOTS[state.profile] || [])[Number(el.dataset.v)];
    el.setAttribute('aria-pressed', String(!!sl && sl[0] === st.value && sl[1] === en.value));
  });
}

function saveForm() {
  const val = (id) => document.getElementById(id).value.trim();
  const title = val('f-title'), date = val('f-date'), start = val('f-start'), end = val('f-end');
  const until = formCtx.weekly ? val('f-until') : '';
  let err = '';
  if (!title) err = 'Введи название пары.';
  else if (!date) err = 'Выбери дату.';
  else if (!start || !end) err = 'Укажи время начала и конца.';
  else if (end <= start) err = 'Конец должен быть позже начала.';
  else if (formCtx.weekly) {
    if (!until) err = 'Выбери, до какой даты повторять.';
    else if (until < date) err = 'Дата «повторять до» раньше даты пары.';
    else if ((Date.parse(until) - Date.parse(date)) / 864e5 > 400) err = 'Повтор не может быть дольше 400 дней (около 57 недель).';
  }
  if (err) {
    const box = document.getElementById('f-err');
    box.textContent = err; box.hidden = false;
    return;
  }
  const entry = { title, kind: formCtx.kind, date, start, end, room: val('f-room'), teacher: val('f-teacher') };
  if (until) {
    entry.until = until;
    const skip = formCtx.skip.filter((d) => d >= date && d <= until && ((Date.parse(d) - Date.parse(date)) / 864e5) % 7 === 0);
    if (skip.length) entry.skip = skip;
  }
  save({ custom: { [formCtx.id]: entry } });
  closeSheet();
}

function confirmTG(msg, ok) {
  if (tg && tg.showConfirm) {
    try { tg.showConfirm(msg, (r) => { if (r) ok(); }); return; } catch (e) { /* старый клиент */ }
  }
  if (window.confirm(msg)) ok();
}

// ---------- «отменить» на 20 секунд ----------
let toastTimer = null;
let undoFn = null;
function hideToast() {
  clearInterval(toastTimer);
  undoFn = null;
  document.getElementById('toast').hidden = true;
}
function toast(msg, undo) {
  clearInterval(toastTimer);
  const el = document.getElementById('toast');
  let left = 20;
  undoFn = undo;
  const paint = () => { el.innerHTML = `<span>${esc(msg)}</span><button data-act="undo">Отменить (${left})</button>`; };
  el.hidden = false;
  paint();
  toastTimer = setInterval(() => { left -= 1; if (left <= 0) hideToast(); else paint(); }, 1000);
}
