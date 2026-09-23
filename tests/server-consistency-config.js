// Сетка пар (SLOTS) и подписи людей (LABEL/NAMES) существуют в двух местах — на клиенте
// (js/core.js) и на сервере (lib/slots.js, lib/digest.js) — и README прямо предупреждает,
// что менять их нужно одновременно. Этот тест ловит забытую правку в одном из файлов.
//
// js/core.js — обычный (не CommonJS) скрипт для браузера: он исполняет код на верхнем уровне
// (тему, Telegram) и не годится для целикового require() в Node. Поэтому две нужные константы
// (SLOTS, LABEL) вытаскиваются из исходного текста регуляркой и вычисляются отдельно, без
// остального файла — сам объект-литерал везде один и тот же код, риска разойтись с файлом нет.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ok = (name, cond, info) => console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (cond ? '' : '   ' + JSON.stringify(info)));

function extractConst(source, name) {
  const m = source.match(new RegExp('const ' + name + ' = (\\{[\\s\\S]*?\\});'));
  if (!m) return undefined;
  return vm.runInNewContext('(' + m[1] + ')');
}

const coreSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'core.js'), 'utf8');
const clientSlots = extractConst(coreSrc, 'SLOTS');
const clientLabel = extractConst(coreSrc, 'LABEL');
const { SLOTS: serverSlots } = require('../lib/slots.js');
const { NAMES: serverNames } = require('../lib/digest.js');

ok('js/core.js: константы SLOTS и LABEL вообще нашлись (не переименовали, не удалили)', !!clientSlots && !!clientLabel, { clientSlots, clientLabel });
ok('SLOTS у Кирилла совпадают между js/core.js и lib/slots.js', JSON.stringify(clientSlots && clientSlots.me) === JSON.stringify(serverSlots.me), { client: clientSlots && clientSlots.me, server: serverSlots.me });
ok('SLOTS у Маши совпадают между js/core.js и lib/slots.js', JSON.stringify(clientSlots && clientSlots.her) === JSON.stringify(serverSlots.her), { client: clientSlots && clientSlots.her, server: serverSlots.her });
ok('в SLOTS одинаковый набор профилей в обоих файлах (только me и her)', JSON.stringify(Object.keys(clientSlots || {}).sort()) === JSON.stringify(Object.keys(serverSlots).sort()));
ok('LABEL (js/core.js) и NAMES (lib/digest.js) — одни и те же имена для me и her', clientLabel && clientLabel.me === serverNames.me && clientLabel.her === serverNames.her, { client: clientLabel, server: serverNames });

// Сами данные внутри SLOTS осмысленные: если кто-то поправит сетку и опечатается (время не
// растёт, конец раньше начала), тест должен споткнуться раньше, чем это заметят люди.
const RE_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
for (const [profile, slots] of Object.entries(serverSlots)) {
  const timesOk = slots.every(([s, e]) => RE_TIME.test(s) && RE_TIME.test(e) && s < e);
  ok(`lib/slots.js: у профиля «${profile}» каждая пара — валидное время, конец позже начала`, timesOk, slots);
  const sorted = slots.every(([s], i) => i === 0 || s > slots[i - 1][0]);
  ok(`lib/slots.js: у профиля «${profile}» пары идут по возрастанию времени`, sorted, slots);
}
process.exit(0);
