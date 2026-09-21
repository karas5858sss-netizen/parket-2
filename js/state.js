// js/state.js — Состояние приложения и всё, что ходит в сеть: расписание, ДЗ/отметки, очередь несохранённого.
// Нужны: core. Файлы общие по области видимости (обычные скрипты), порядок подключения в index.html важен.
(window.PARTS = window.PARTS || []).push('state');

const cachedState = readJSON('parket.state', null);
const pending = readJSON('parket.pending', {});
pending.hw = pending.hw || {};
pending.done = pending.done || {};
pending.colors = pending.colors || {};
pending.custom = pending.custom || {};
pending.prefs = pending.prefs || {};

const state = {
  who: cachedState && cachedState.who ? cachedState.who : null, // чей это телефон: 'me' | 'her'
  docs: cachedState && cachedState.docs ? { me: normDoc(cachedState.docs.me), her: normDoc(cachedState.docs.her) } : { me: emptyDoc(), her: emptyDoc() },
  profile: (cachedState && cachedState.who) || (store.get('parket.profile') === 'her' ? 'her' : 'me'),
  userPicked: false,
  tab: ['week', 'month', 'subjects', 'search', 'stats'].includes(store.get('parket.tab')) ? store.get('parket.tab') : 'today',
  data: {},        // profile -> { lessons, group, fetchedAt, errors }
  err: null,
  loading: false,
  sync: { code: 'idle' },
  changes: readJSON('parket.changes', { me: [], her: [] }),   // журнал изменений расписания
  weekOf: null,    // понедельник показанной недели
  selDate: null,   // выбранный день в «Неделе»
  month: null,     // показанный месяц 'YYYY-MM'
  calSel: null,    // выбранный день в «Месяце»
  calMode: ['month', 'subjects'].includes(store.get('parket.calmode')) ? store.get('parket.calmode') : 'week', // масштаб вкладки «Календарь»
  q: '', kind: 'all', onlyHw: false, past: false, limit: 50, // поиск
};
const readCache = (p) => { try { return JSON.parse(store.get('parket.cache.' + p)); } catch (e) { return null; } };
const writeCache = (p, d) => store.set('parket.cache.' + p, JSON.stringify(d));

// ---------- расписание ----------
async function load(profile) {
  if (!state.data[profile]) { const c = readCache(profile); if (c) state.data[profile] = c; }
  state.loading = true; state.err = null;
  render();
  try {
    const r = await fetch('/api/schedule?profile=' + profile);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    state.data[profile] = { lessons: j.lessons, group: j.group, fetchedAt: j.fetchedAt, errors: j.errors || [] };
    writeCache(profile, state.data[profile]);
  } catch (e) {
    state.err = e.message || 'сеть недоступна';
  } finally {
    state.loading = false;
    if (state.profile === profile) render();
  }
}

let lastChangesAt = 0;
async function loadChanges() {
  if (!tg || !tg.initData || !state.who) return;
  try {
    const r = await fetch('/api/changes', { headers: { 'X-Init-Data': tg.initData }, cache: 'no-store' });
    if (!r.ok) return;
    const j = await r.json();
    state.changes = { me: (j.items && j.items.me) || [], her: (j.items && j.items.her) || [] };
    store.set('parket.changes', JSON.stringify(state.changes));
    lastChangesAt = Date.now();
  } catch (e) { /* журнал необязателен */ }
}

async function loadQuiet(profile) {
  if (!state.data[profile]) { const c = readCache(profile); if (c) { state.data[profile] = c; render(); } }
  try {
    const r = await fetch('/api/schedule?profile=' + profile);
    if (!r.ok) return;
    const j = await r.json();
    state.data[profile] = { lessons: j.lessons, group: j.group, fetchedAt: j.fetchedAt, errors: j.errors || [] };
    writeCache(profile, state.data[profile]);
    render();
  } catch (e) { /* второй профиль необязателен */ }
}

// ---------- общее хранилище: ДЗ и отметки ----------
const hasPending = () => Object.keys(pending.hw).length + Object.keys(pending.done).length + Object.keys(pending.colors).length + Object.keys(pending.custom).length + Object.keys(pending.prefs).length > 0;
const persistState = () => store.set('parket.state', JSON.stringify({ who: state.who, docs: state.docs }));
const persistPending = () => store.set('parket.pending', JSON.stringify(pending));
let lastStateAt = 0;

function applyLocal(doc, patch) {
  const now = Date.now();
  for (const [k, v] of Object.entries(patch.hw || {})) {
    if (!v || !v.text) delete doc.hw[k];
    else doc.hw[k] = { name: v.name || '', text: v.text, done: !!v.done, t: now };
  }
  for (const [k, v] of Object.entries(patch.done || {})) {
    if (v) doc.done[k] = now; else delete doc.done[k];
  }
  if (!doc.prefs) doc.prefs = {};
  if (patch.prefs && typeof patch.prefs.notify === 'boolean') doc.prefs.notify = patch.prefs.notify;
  if (patch.prefs && patch.prefs.seen) doc.prefs.seen = Object.assign({}, doc.prefs.seen, patch.prefs.seen);
  if (!doc.custom) doc.custom = {};
  for (const [k, v] of Object.entries(patch.custom || {})) {
    if (v) doc.custom[k] = Object.assign({}, v, { t: now }); else delete doc.custom[k];
  }
  if (!doc.colors) doc.colors = {};
  for (const [k, v] of Object.entries(patch.colors || {})) {
    if (Number.isInteger(v) && v >= 0 && v < PALETTE.length) doc.colors[k] = v; else delete doc.colors[k];
  }
}

async function loadState() {
  if (!tg || !tg.initData) { state.sync = { code: 'browser' }; return; }
  try {
    const r = await fetch('/api/state', { headers: { 'X-Init-Data': tg.initData }, cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    if (r.status === 403) { state.sync = { code: 'denied', id: j.yourId }; return; }
    if (r.status === 503) { state.sync = { code: 'off' }; return; }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    state.who = j.who;
    state.docs = { me: normDoc(j.docs && j.docs.me), her: normDoc(j.docs && j.docs.her) };
    applyLocal(state.docs[state.who], pending); // несохранённые правки остаются поверх серверных данных
    state.sync = { code: 'ok' };
    lastStateAt = Date.now();
    persistState();
  } catch (e) {
    state.sync = { code: 'error', msg: e.message };
  }
}

let flushing = false;
async function flush() {
  if (flushing || !tg || !tg.initData || !state.who || !hasPending()) return;
  const snap = JSON.stringify(pending);
  flushing = true;
  try {
    const r = await fetch('/api/state', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Init-Data': tg.initData },
      body: snap,
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const sent = JSON.parse(snap);
    for (const k of Object.keys(sent.hw)) if (JSON.stringify(pending.hw[k]) === JSON.stringify(sent.hw[k])) delete pending.hw[k];
    for (const k of Object.keys(sent.done)) if (pending.done[k] === sent.done[k]) delete pending.done[k];
    for (const k of Object.keys(sent.colors || {})) if (pending.colors[k] === sent.colors[k]) delete pending.colors[k];
    for (const k of Object.keys(sent.custom || {})) if (JSON.stringify(pending.custom[k]) === JSON.stringify(sent.custom[k])) delete pending.custom[k];
    for (const k of Object.keys(sent.prefs || {})) if (JSON.stringify(pending.prefs[k]) === JSON.stringify(sent.prefs[k])) delete pending.prefs[k];
    persistPending();
  } catch (e) { /* останется в очереди, отправим при следующем случае */ }
  finally { flushing = false; render(); }
}

function save(patch) {
  if (!canEdit()) return;
  applyLocal(state.docs[state.who], patch);
  Object.assign(pending.hw, patch.hw || {});
  Object.assign(pending.done, patch.done || {});
  Object.assign(pending.colors, patch.colors || {});
  Object.assign(pending.custom, patch.custom || {});
  persistState(); persistPending();
  render();
  flush();
}
// настройки относятся к владельцу телефона и сохраняются, даже если открыт профиль партнёра
function savePref(patch) {
  if (!state.who) return;
  applyLocal(state.docs[state.who], patch);
  const pp = patch.prefs || {};
  if (typeof pp.notify === 'boolean') pending.prefs.notify = pp.notify;
  if (pp.seen) pending.prefs.seen = Object.assign({}, pending.prefs.seen, pp.seen);
  persistState(); persistPending();
  render();
  flush();
}
const notifyOn = () => !!state.who && state.docs[state.who].prefs.notify !== false;
const saveHw = (sk, name, text, done) => save({ hw: { [sk]: text ? { name, text, done } : null } });
