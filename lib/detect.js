// lib/detect.js — обнаружение изменений расписания: снимки и журнал в Redis.
// Используется в api/changes.js (при открытии приложения) и api/notify.js (вечерний cron).

const { redis } = require('./shared');
const { buildSnapshot, diffSnapshots, mergeLog, isSuspicious } = require('./changes');

const LOCK_SEC = 300;       // не чаще раза в 5 минут на профиль
const FETCH_TIMEOUT_MS = 9000;
const SUSPICIOUS_LIMIT = 3; // столько подряд «странных» ответов, и принимаем как есть
const K = {
  snap: (p) => 'parket:v1:snap:' + p,
  chg: (p) => 'parket:v1:chg:' + p,
  lock: (p) => 'parket:v1:lock:' + p,
};

async function readJson(key, fallback) {
  const raw = await redis(['GET', key]);
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch (e) { return fallback; }
}

async function fetchScheduleFull(base, profile) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(`${base}/api/schedule?profile=${profile}`, { signal: ctrl.signal });
    if (!r.ok) return null;
    const j = await r.json();
    return Array.isArray(j.lessons) ? j : null;
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function detectProfile({ base, profile, today, nowIso }) {
  const got = await redis(['SET', K.lock(profile), '1', 'NX', 'EX', String(LOCK_SEC)]);
  if (got !== 'OK') return { profile, skipped: 'locked' };

  const sched = await fetchScheduleFull(base, profile);
  if (!sched) return { profile, skipped: 'no_schedule' };
  if (sched.errors && sched.errors.length) return { profile, skipped: 'partial' }; // часть недель не загрузилась: не сравниваем

  const newS = buildSnapshot(sched.lessons, nowIso, today);
  const oldS = await readJson(K.snap(profile), null);
  if (!oldS) {
    await redis(['SET', K.snap(profile), JSON.stringify(newS)]);
    return { profile, baseline: true };
  }
  if (isSuspicious(oldS, newS, today)) {
    const sus = (oldS.sus || 0) + 1;
    if (sus < SUSPICIOUS_LIMIT) {
      oldS.sus = sus;
      await redis(['SET', K.snap(profile), JSON.stringify(oldS)]);
      return { profile, skipped: 'suspicious', sus };
    }
  }
  const entries = diffSnapshots(oldS, newS, today);
  if (entries.length) {
    const log = mergeLog(await readJson(K.chg(profile), []), entries, nowIso, today);
    await redis(['SET', K.chg(profile), JSON.stringify(log)]);
  }
  await redis(['SET', K.snap(profile), JSON.stringify(newS)]);
  return { profile, changes: entries.length };
}

async function readLogs(profiles, today, nowIso) {
  const items = {};
  await Promise.all(profiles.map(async (p) => {
    items[p] = mergeLog(await readJson(K.chg(p), []), [], nowIso, today); // устаревшее отбрасываем и при чтении
  }));
  return items;
}

async function refreshChanges({ base, today, nowIso, profiles = ['me', 'her'] }) {
  const detect = await Promise.all(profiles.map((profile) =>
    detectProfile({ base, profile, today, nowIso }).catch((e) => ({ profile, error: String((e && e.message) || e) }))));
  return { items: await readLogs(profiles, today, nowIso), detect };
}

module.exports = { refreshChanges, readLogs };
