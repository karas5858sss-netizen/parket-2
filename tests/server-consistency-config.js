// Сетка пар и имена людей раньше существовали в двух местах (js/core.js и lib/slots.js /
// lib/digest.js) и приходилось следить, чтобы правка одного файла не забыла про другой.
// Теперь единственный источник — config/profiles.js: и клиент (обычный <script>, кладёт себя
// в window.PEOPLE), и сервер (require) читают именно его. Этот тест проверяет две вещи:
// 1) сам конфиг осмысленный (валидное время, конец пары позже начала, пары идут по возрастанию);
// 2) файлы, которые раньше хранили копию, теперь её не завели заново — читают PEOPLE, а не
//    хардкодят свой собственный литерал (иначе весь смысл переноса в один файл теряется молча).
const fs = require('fs');
const path = require('path');

const ok = (name, cond, info) => console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (cond ? '' : '   ' + JSON.stringify(info)));

const PEOPLE = require('../config/profiles.js');
const { SLOTS: serverSlots } = require('../lib/slots.js');
const { NAMES: serverNames } = require('../lib/digest.js');

// ---------- сам конфиг ----------
ok('config/profiles.js: есть оба профиля с именем, падежами и сеткой', ['me', 'her'].every((p) => PEOPLE[p] && PEOPLE[p].name && PEOPLE[p].free && PEOPLE[p].busy && Array.isArray(PEOPLE[p].slots)), PEOPLE);
const RE_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
for (const [profile, p] of Object.entries(PEOPLE)) {
  const timesOk = p.slots.every(([s, e]) => RE_TIME.test(s) && RE_TIME.test(e) && s < e);
  ok(`config/profiles.js: у «${profile}» каждая пара — валидное время, конец позже начала`, timesOk, p.slots);
  const sorted = p.slots.every(([s], i) => i === 0 || s > p.slots[i - 1][0]);
  ok(`config/profiles.js: у «${profile}» пары идут по возрастанию времени`, sorted, p.slots);
}

// ---------- server/lib читают именно PEOPLE, а не завели свою копию ----------
ok('lib/slots.js: SLOTS совпадает с config/profiles.js (значения, не структура — сверка на подмене конфига ниже)', JSON.stringify(serverSlots) === JSON.stringify({ me: PEOPLE.me.slots, her: PEOPLE.her.slots }));
ok('lib/digest.js: NAMES совпадает с config/profiles.js', serverNames.me === PEOPLE.me.name && serverNames.her === PEOPLE.her.name);
for (const [file, needle] of [['../lib/slots.js', "require('../config/profiles.js')"], ['../lib/digest.js', "require('../config/profiles.js')"]]) {
  const src = fs.readFileSync(path.join(__dirname, file), 'utf8');
  ok(`${file.replace('../', '')}: реально require()-ит config/profiles.js (не просто совпало значением)`, src.includes(needle));
}

// ---------- подмена конфига в require-кеше: если lib/slots.js держит свою копию, а не ссылку, это не заметят другие проверки — заметит эта ----------
delete require.cache[require.resolve('../config/profiles.js')];
delete require.cache[require.resolve('../lib/slots.js')];
delete require.cache[require.resolve('../lib/digest.js')];
const Module = require('module');
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request.endsWith('config/profiles.js') || request === '../config/profiles.js') {
    return { me: { name: 'Тест-Кирилл', free: 'x', busy: 'y', slots: [['01:00', '02:00']] }, her: { name: 'Тест-Маша', free: 'x', busy: 'y', slots: [['03:00', '04:00']] } };
  }
  return realLoad.apply(this, arguments);
};
try {
  delete require.cache[require.resolve('../lib/slots.js')];
  delete require.cache[require.resolve('../lib/digest.js')];
  const { SLOTS: swappedSlots } = require('../lib/slots.js');
  const { NAMES: swappedNames } = require('../lib/digest.js');
  ok('lib/slots.js реально подхватывает подменённый config (SLOTS.me = [01:00-02:00])', swappedSlots.me[0][0] === '01:00', swappedSlots);
  ok('lib/digest.js реально подхватывает подменённый config (NAMES.me = «Тест-Кирилл»)', swappedNames.me === 'Тест-Кирилл', swappedNames);
} finally {
  Module._load = realLoad;
  delete require.cache[require.resolve('../lib/slots.js')];
  delete require.cache[require.resolve('../lib/digest.js')];
}

// ---------- js/core.js больше не содержит свою копию сетки/имён, а «переупаковывает» PEOPLE ----------
const coreSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'core.js'), 'utf8');
ok('js/core.js не хардкодит время пар литералом (нет старого объекта с массивами времени)', !/const SLOTS = \{\s*\n\s*me: \[\[/.test(coreSrc), coreSrc.match(/const SLOTS[^;]*/)[0]);
ok('js/core.js берёт SLOTS/LABEL/FREE из PEOPLE (единственный источник)', /PEOPLE\.me\.slots/.test(coreSrc) && /PEOPLE\.me\.name/.test(coreSrc) && /PEOPLE\.me\.free/.test(coreSrc));

const domSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'domain.js'), 'utf8');
ok('js/domain.js: pairNo(profile, lesson) — тот же порядок аргументов, что и на сервере (lib/slots.js)', /function pairNo\(profile, l\)/.test(domSrc));

// ---------- index.html подключает config/profiles.js раньше js/core.js ----------
const htmlSrc = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const iConfig = htmlSrc.indexOf('config/profiles.js');
const iCore = htmlSrc.indexOf('js/core.js');
ok('index.html: <script config/profiles.js> подключён раньше js/core.js', iConfig > -1 && iCore > -1 && iConfig < iCore);
ok('index.html: защита от неполной заливки знает про config/profiles.js', /'config'/.test(htmlSrc) && /config\/profiles\.js/.test(htmlSrc));
process.exit(0);
