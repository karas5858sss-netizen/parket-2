// lib/slots.js — сетка пар у каждого. Значения берутся из config/profiles.js (PEOPLE.<профиль>.slots) —
// это единственное место, где их нужно менять. Здесь только номер пары по времени начала (pairNo).
// Номер пары определяется по времени начала.

const PEOPLE = require('../config/profiles.js');
const SLOTS = { me: PEOPLE.me.slots, her: PEOPLE.her.slots };

// Номер пары: по сетке, иначе номер из расписания вуза, иначе 0 (не нумеруется).
function pairNo(profile, l) {
  const i = (SLOTS[profile] || []).findIndex((s) => s[0] === l.start);
  if (i >= 0) return i + 1;
  return !l.custom && l.num > 0 ? l.num : 0;
}

module.exports = { SLOTS, pairNo };
