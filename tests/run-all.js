// Запускает все тесты и показывает итог. Код выхода 1, если что-то не прошло.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const files = fs.readdirSync(__dirname).filter((f) => /^(client|server)-.*\.js$/.test(f)).sort();
let pass = 0;
const bad = [];
for (const f of files) {
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { encoding: 'utf8', timeout: 180000, env: process.env });
  const out = r.stdout || '';
  const p = (out.match(/^PASS /gm) || []).length;
  const failLines = out.split('\n').filter((l) => /^FAIL /.test(l) || /JS ERRORS/.test(l));
  const crashed = r.status !== 0 || !!r.signal;
  pass += p;
  const ok = !failLines.length && !crashed && p > 0;
  console.log((ok ? 'ok   ' : 'FAIL ') + f.padEnd(34) + p + ' проверок');
  if (!ok) {
    bad.push(f);
    failLines.forEach((l) => console.log('       ' + l));
    if (crashed) console.log('       тест завершился аварийно (код ' + r.status + ')\n' + String(r.stderr || '').split('\n').slice(0, 8).map((l) => '       ' + l).join('\n'));
    if (p === 0 && !crashed) console.log('       ни одной проверки не выполнено');
  }
}
console.log('\nИтого прошло проверок: ' + pass + (bad.length ? ', ПРОВАЛЕНЫ наборы: ' + bad.join(', ') : ', всё в порядке'));
process.exit(bad.length ? 1 : 0);
