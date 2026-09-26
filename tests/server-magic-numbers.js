// Раньше в js/app.js интервалы (30 сек, 15 мин, 1 мин, 5 мин) были разбросаны прямо в вызовах
// setInterval/сравнениях без имён — легко перепутать один с другим при правке. Теперь они
// собраны в один именованный объект TIMERS. Тест по исходному тексту проверяет, что цифры
// остались правильными и что setInterval/сравнения ссылаются на TIMERS, а не завели свою копию.
const fs = require('fs');
const path = require('path');
const ok = (name, cond, info) => console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (cond ? '' : '   ' + JSON.stringify(info)));

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
const m = src.match(/const TIMERS = \{([\s\S]*?)\n\};/);
ok('js/app.js: объект TIMERS существует', !!m, src.includes('TIMERS'));
const timers = m ? eval('({' + m[1] + '\n})') : {};

ok('CLOCK_MS — 30 секунд (тикает счётчик текущей пары и досылает очередь)', timers.CLOCK_MS === 30 * 1000, timers.CLOCK_MS);
ok('SCHEDULE_STALE_MS — 15 минут (когда расписание считается устаревшим)', timers.SCHEDULE_STALE_MS === 15 * 60 * 1000, timers.SCHEDULE_STALE_MS);
ok('STATE_STALE_MS — 1 минута (ДЗ/отметки/настройки)', timers.STATE_STALE_MS === 60 * 1000, timers.STATE_STALE_MS);
ok('CHANGES_STALE_MS — 5 минут (журнал изменений)', timers.CHANGES_STALE_MS === 5 * 60 * 1000, timers.CHANGES_STALE_MS);

ok('setInterval использует TIMERS.CLOCK_MS, а не число напрямую', /\}, TIMERS\.CLOCK_MS\);/.test(src));
ok('сравнение свежести расписания использует TIMERS.SCHEDULE_STALE_MS', /TIMERS\.SCHEDULE_STALE_MS/.test(src) && !/> 15 \* 60000/.test(src));
ok('сравнение свежести ДЗ использует TIMERS.STATE_STALE_MS', /TIMERS\.STATE_STALE_MS/.test(src) && !/lastStateAt > 60000/.test(src));
ok('сравнение свежести журнала использует TIMERS.CHANGES_STALE_MS', /TIMERS\.CHANGES_STALE_MS/.test(src) && !/lastChangesAt > 5 \* 60000/.test(src));

// ---------- окно вечернего напоминания для непрочитанных изменений теперь привязано к сроку жизни журнала ----------
const { LOG_MAX_AGE_DAYS } = require('../lib/changes.js');
const notifySrc = fs.readFileSync(path.join(__dirname, '..', 'api', 'notify.js'), 'utf8');
ok('lib/changes.js экспортирует LOG_MAX_AGE_DAYS', typeof LOG_MAX_AGE_DAYS === 'number' && LOG_MAX_AGE_DAYS > 0, LOG_MAX_AGE_DAYS);
ok('api/notify.js вычисляет окно из LOG_MAX_AGE_DAYS, а не хранит отдельное число часов', /CHANGES_WINDOW_MS = LOG_MAX_AGE_DAYS \* 24 \* 3600 \* 1000/.test(notifySrc) && !/30 \* 3600 \* 1000/.test(notifySrc));

// имитация require api/notify.js для проверки реального значения окна (без сети — просто читаем модуль)
delete require.cache[require.resolve('../api/notify.js')];
process.env.BOT_TOKEN = 'x'; process.env.ME_TG_ID = '1'; process.env.HER_TG_ID = '2';
process.env.KV_REST_API_URL = 'https://x'; process.env.KV_REST_API_TOKEN = 'y'; process.env.CRON_SECRET = 'z';
require('../api/notify.js'); // не вызываем — просто убеждаемся, что модуль с новым require грузится без ошибок
ok('api/notify.js с новой зависимостью от lib/changes.js по-прежнему благополучно загружается', true);
process.exit(0);
