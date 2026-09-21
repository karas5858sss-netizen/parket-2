const { JSDOM } = require('jsdom');
const fs = require('fs');
const html = require('./load.js');
let idc = 1;
const mk = (date, s, e, subject, kind) => ({ id: idc++, date, start: s, end: e, startAt: date+'T'+s+':00', endAt: date+'T'+e+':00', num: 1, kind, subject, title: subject, teacher: 'Т.Т.', room: '8-431', color: '#008000', subgroup: 0, weekType: 1, replaced: false });
const ORG = 'Основы российской государственности', INK = 'Инклюзия - зона доступа', PSY = 'Общая психология', VOE = 'ОСНОВЫ ВОЕННОЙ ПОДГОТОВКИ (Нижняя ср)';
const herLessons = [
  mk('2026-09-14','10:15','11:50',ORG,'пр'), mk('2026-09-14','12:00','13:35',INK,'пр'),
  mk('2026-09-15','08:30','10:05',INK,'лек'),
  mk('2026-09-19','08:30','10:05',INK,'пр'), mk('2026-09-19','10:15','11:50',ORG,'пр'), mk('2026-09-19','12:00','13:35',ORG,'лек'),
  mk('2026-09-21','08:30','10:05',INK,'пр'), mk('2026-09-21','10:15','11:50',ORG,'пр'), mk('2026-09-21','12:00','13:35',PSY,'пр'), mk('2026-09-21','14:15','15:50',PSY,'лек'),
  mk('2026-09-23','08:30','10:05',VOE,'лек'),
];
const sched = { her: { group: 'ДСО12', fetchedAt: '2026-09-19T03:55:00.000Z', errors: [], lessons: herLessons },
                me: { group: 'Мо-24', fetchedAt: '2026-09-19T03:55:00.000Z', errors: [], lessons: [ mk('2026-09-21','09:40','11:10','Конструкция','лек') ] } };
const wait = (ms = 60) => new Promise(r => setTimeout(r, ms));
const ok = (name, cond) => console.log((cond ? 'PASS' : 'FAIL') + '  ' + name);
async function boot(sc, docs) {
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://parket-2.vercel.app/', pretendToBeVisual: true,
    beforeParse(w) {
      w.__NOW = '2026-09-19T07:00:00';
      w.Telegram = { WebApp: { initData: 'fake', ready(){}, expand(){}, colorScheme: 'light', showConfirm(m, cb){ cb(true); } } };
      w.fetch = async (url, opts = {}) => {
        const j = (b) => ({ ok: true, status: 200, json: async () => b });
        if (url.startsWith('/api/schedule')) return j(sc[url.split('=')[1]]);
        if (url === '/api/state' && opts.method === 'POST') return j({ ok: true });
        if (url === '/api/state') return j({ who: 'her', docs });
      };
    } });
  const errs = []; dom.window.addEventListener('error', e => errs.push(e.message));
  await wait(150);
  const d = dom.window.document;
  return { dom, d, errs, txt: () => d.getElementById('app').textContent.replace(/\s+/g, ' ').trim(),
    click: async (sel) => { const el = d.querySelector(sel); if (!el) { console.log('  (нет ' + sel + ')'); return; } el.click(); await wait(); }, close() { dom.window.close(); } };
}
(async () => {
  const docs = { me: { hw: {}, done: {}, colors: {}, custom: {} },
    her: { hw: { [ORG.toLowerCase()]: { name: ORG, text: 'Конспект', done: false, t: 1 }, [PSY.toLowerCase()]: { name: PSY, text: 'Реферат', done: true, t: 1 } },
           done: { '2026-09-19|08:30|инклюзия - зона доступа': 1 }, colors: { 'инклюзия - зона доступа': 8 }, custom: {} } };
  let t = await boot(sched, docs);
  ok('4 вкладки, есть «Итоги»', t.d.querySelectorAll('.tabs button').length === 4 && t.txt().includes('Итоги'));
  ok('на «Сегодня» кнопка «+» есть', !!t.d.querySelector('.fab'));
  await t.click('[data-tab="stats"]');
  ok('на «Итогах» кнопки «+» нет', !t.d.querySelector('.fab'));
  const T = t.txt();
  ok('прогресс: 27%, пройдено 3 из 11, вручную 1', T.includes('27%') && T.includes('Пройдено пар: 3 из 11') && T.includes('Отмечено вручную: 1'));
  ok('период по расписанию: с 14 сентября по 23 сентября', T.includes('с 14 сентября по 23 сентября'));
  const subj = [...t.d.querySelectorAll('.subj')].map(x => x.textContent.replace(/\s+/g, ' ').trim());
  ok('предметы отсортированы (Инклюзия, ОРГ, Психология, Военка)', subj.length === 4 && subj[0].startsWith('Инклюзия') && subj[1].startsWith('Основы российской') && subj[2].startsWith('Общая психология') && subj[3].startsWith('ОСНОВЫ ВОЕННОЙ'));
  ok('счётчики: Инклюзия 2 из 4, ОРГ 1 из 4, Психология 0 из 2', subj[0].includes('2 из 4') && subj[1].includes('1 из 4') && subj[2].includes('0 из 2'));
  ok('типы пар по предмету (Инклюзия: пр 3, лек 1)', subj[0].includes('пр 3') && subj[0].includes('лек 1'));
  ok('цвет предмета на строке статистики', t.d.querySelector('.subj.colored') && t.d.querySelector('.subj.colored').textContent.includes('Инклюзия'));
  const tiles = [...t.d.querySelectorAll('.tile')].map(x => x.textContent.trim());
  ok('ДЗ: 1 активное, 1 выполнено', tiles[0].startsWith('1') && tiles[1].startsWith('1'));
  ok('срок ДЗ: сдать к Сб, 19 сентября (ближайшая пара предмета)', t.d.querySelector('.hwitem .due').textContent.includes('Сб, 19 сентября'));
  const rows = [...t.d.querySelectorAll('.dayrow')].map(x => x.textContent.replace(/\s+/g, ' ').trim());
  ok('самый загруженный день впереди: Пн 21 сентября, пар 4, 08:30–15:50', rows[0].includes('21 сентября') && rows[0].includes('пар: 4') && rows[0].includes('08:30–15:50'));
  ok('второй: Сб 19 сентября (3 пары), прошедший 14.09 не входит', rows[1].includes('19 сентября') && !rows.slice(0, 3).some(r => r.includes('14 сентября')));
  console.log('   недели:', rows.filter(r => /^(Пн|Вт|Ср|Чт|Пт|Сб|Вс)\d/.test(r)).join(' | ')); ok('по дням недели: Пн 6, Сб 3, Вс нет', rows.some(r => r.startsWith('Пн6')) && rows.some(r => r.startsWith('Сб3')) && !rows.some(r => /^Вс\d/.test(r)));
  await t.click('.hwitem');
  ok('из статистики открывается лист ДЗ', !!t.d.querySelector('#sheet textarea'));
  t.d.querySelector('[data-act="sheet-close"]').click();
  await t.click('[data-act="profile"][data-p="me"]');
  ok('чужой профиль: своя статистика (1 пара, 0%)', t.txt().includes('0%') && t.txt().includes('Пройдено пар: 0 из 1'));
  if (t.errs.length) console.log('JS ERRORS', t.errs); t.close();
  // пустое расписание
  t = await boot({ her: { group: 'X', fetchedAt: sched.her.fetchedAt, errors: [], lessons: [] }, me: sched.me }, docs);
  await t.click('[data-tab="stats"]');
  ok('нет пар: аккуратное пустое состояние', t.txt().includes('Пока нет пар для статистики'));
  t.close();
  process.exit(0);
})();
