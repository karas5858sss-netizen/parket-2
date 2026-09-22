// js/core.js — Ядро: Telegram, хранилище браузера, тема, даты, константы (палитра, сетка пар, подписи).
// Нужны: ничего (грузится первым). Файлы общие по области видимости (обычные скрипты), порядок подключения в index.html важен.
(window.PARTS = window.PARTS || []).push('core');

// Версия сборки: меняй при выкладке, она видна внизу «Настроек» (чтобы понять, что телефон получил свежие файлы).
const BUILD = '2026-09-21.3';

const tg = window.Telegram && window.Telegram.WebApp;
if (tg) {
  try { tg.ready(); tg.expand(); } catch (e) {}
  document.documentElement.dataset.scheme = tg.colorScheme || 'light';
}

// ---------- хранилище ----------
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
};
const readJSON = (k, d) => { try { const v = JSON.parse(store.get(k)); return v == null ? d : v; } catch (e) { return d; } };
const emptyDoc = () => ({ hw: {}, done: {}, colors: {}, custom: {}, prefs: {} });
const normDoc = (d) => ({ hw: (d && d.hw) || {}, done: (d && d.done) || {}, colors: (d && d.colors) || {}, custom: (d && d.custom) || {}, prefs: (d && d.prefs) || {} });

// ---------- тема: Как в Telegram / Светлая / Тёмная ----------
const THEME_BG = { light: '#ffffff', dark: '#17181c' };
const themePref = () => { const t = store.get('parket.theme'); return t === 'light' || t === 'dark' ? t : 'auto'; };
function applyTheme() {
  const pref = themePref();
  const root = document.documentElement;
  let scheme;
  if (pref === 'auto') {
    delete root.dataset.theme;
    scheme = (tg && tg.colorScheme) || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  } else {
    root.dataset.theme = pref;
    scheme = pref;
  }
  root.dataset.scheme = scheme;
  if (tg) {
    try {
      const c = pref === 'auto' ? 'bg_color' : THEME_BG[pref];
      tg.setHeaderColor(c);
      tg.setBackgroundColor(c);
      if (tg.setBottomBarColor && pref !== 'auto') tg.setBottomBarColor(c);
    } catch (e) { /* старый клиент */ }
  }
}
applyTheme();
if (tg && tg.onEvent) { try { tg.onEvent('themeChanged', () => { if (themePref() === 'auto') applyTheme(); }); } catch (e) {} }

const LABEL = { me: 'Кирилл', her: 'Маша' };
const FREE = { me: 'свободен', her: 'свободна' };
const otherOf = (p) => (p === 'me' ? 'her' : 'me');
// ---------- время (расписание вуза идёт по Москве) ----------
const pad = (n) => String(n).padStart(2, '0');
function nowMsk() {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).format(new Date()).replace(' ', 'T');
}
const nowStr = () => window.__NOW || nowMsk();          // __NOW нужен только для тестов
const ms = (s) => Date.parse(s + 'Z');
const WD = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const MON = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MON_N = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const MON_S = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const dOf = (s) => new Date(s + 'T00:00:00Z');
const dow = (s) => dOf(s).getUTCDay();
const addDays = (s, n) => new Date(dOf(s).getTime() + n * 864e5).toISOString().slice(0, 10);
const mondayOf = (s) => addDays(s, -((dow(s) + 6) % 7));
const human = (s) => { const d = dOf(s); return d.getUTCDate() + ' ' + MON[d.getUTCMonth()]; };
const dur = (m) => (m < 60 ? m + ' мин' : Math.floor(m / 60) + ' ч' + (m % 60 ? ' ' + (m % 60) + ' мин' : ''));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- цветовые метки предметов (16) ----------
const PALETTE = [
  ['#e5484d', 'красный'], ['#f08a24', 'оранжевый'], ['#e0b000', 'янтарный'], ['#8fbf2a', 'лаймовый'],
  ['#2fa35a', 'зелёный'], ['#12a594', 'изумрудный'], ['#16b0c9', 'бирюзовый'], ['#3b9cf0', 'голубой'],
  ['#3e63dd', 'синий'], ['#6e56cf', 'индиго'], ['#9b51e0', 'фиолетовый'], ['#c94fc0', 'пурпурный'],
  ['#e5508f', 'розовый'], ['#b5654a', 'терракотовый'], ['#7b8794', 'серый'], ['#c2a878', 'песочный'],
];
// ---------- нумерация пар: у каждого своя сетка (копия в lib/slots.js) ----------
const SLOTS = {
  me: [['08:00', '09:30'], ['09:40', '11:10'], ['11:50', '13:20'], ['13:30', '15:00'], ['15:40', '17:10'], ['17:20', '18:50']],
  her: [['08:30', '10:05'], ['10:15', '11:50'], ['12:00', '13:35'], ['14:15', '15:50'], ['16:00', '17:35']],
};
const plural = (n, f) => { const a = n % 100; const b = n % 10; return f[a > 10 && a < 20 ? 2 : b === 1 ? 0 : b >= 2 && b <= 4 ? 1 : 2]; };
const KIND_CLS = { 'лек': 'lec', 'пр': 'pr', 'лаб': 'lab' };

// ---------- вспомогательное для времени ----------
const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
