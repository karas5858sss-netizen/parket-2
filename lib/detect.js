// lib/detect.js — обнаружение изменений расписания: снимки и журнал в Redis.
// Используется в api/changes.js (при открытии приложения) и api/notify.js (вечерний cron).

const { redis, fetchSchedule } = require('./shared');
const { buildSnapshot, diffSnapshots, mergeLog, isSuspicious } = require('./changes');

const LOCK_SEC = 300;       // не чаще раза в 5 минут на профиль
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

// schedules: необязательные уже загруженные расписания { me, her }, каждое — ответ /api/schedule целиком
// или null. Так вечерний cron (api/notify.js) не запрашивает расписание дважды: один раз для текста
// напоминания и второй раз здесь. api/changes.js схемы не передаёт — тогда каждый профиль запрашивается сам.
async function detectProfile({ base, profile, today, nowIso, schedules }) {
  const got = await redis(['SET', K.lock(profile), '1', 'NX', 'EX', String(LOCK_SEC)]);
  if (got !== 'OK') return { profile, skipped: 'locked' };

  const has = schedules && Object.prototype.hasOwnProperty.call(schedules, profile);
  const sched = has ? schedules[profile] : await fetchSchedule(base, profile);
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

async function refreshChanges({ base, today, nowIso, profiles = ['me', 'her'], schedules }) {
  const detect = await Promise.all(profiles.map((profile) =>
    detectProfile({ base, profile, today, nowIso, schedules }).catch((e) => ({ profile, error: String((e && e.message) || e) }))));
  return { items: await readLogs(profiles, today, nowIso), detect };
}

module.exports = { refreshChanges, readLogs };
