// Файлы js/*.js делят одну область видимости, поэтому имена верхнего уровня не должны повторяться
// и не должны совпадать со встроенными именами окна браузера (name, top, open, status…).
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const dir = path.join(__dirname, '..', 'js');
const order = ['core', 'state', 'domain', 'cards', 'views', 'sheets', 'app'];
const seen = {};
const dups = [];
for (const f of order) {
  for (const line of fs.readFileSync(path.join(dir, f + '.js'), 'utf8').split('\n')) {
    const m = line.match(/^(?:const|let|class|function|async function)\s+([A-Za-z_$][\w$]*)/);
    if (!m) continue;
    if (seen[m[1]]) dups.push(`${m[1]} (${seen[m[1]]} и ${f})`);
    seen[m[1]] = f;
  }
}
const builtin = new Set(Object.getOwnPropertyNames(new JSDOM('<!doctype html>').window));
// то, чего может не быть в jsdom, но есть в настоящих браузерах
['name', 'status', 'top', 'parent', 'self', 'event', 'length', 'open', 'close', 'stop', 'focus', 'blur', 'print', 'find', 'confirm', 'alert', 'prompt',
 'scroll', 'origin', 'history', 'screen', 'external', 'closed', 'frames', 'opener', 'toolbar', 'menubar', 'crypto', 'performance', 'caches',
 'navigator', 'location', 'document', 'window', 'customElements', 'clientInformation', 'styleMedia', 'visualViewport'].forEach((n) => builtin.add(n));
const clash = Object.keys(seen).filter((n) => builtin.has(n));
const ok = (name, cond, info) => console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (cond ? '' : '   ' + info));

ok('в файлах js/ есть объявления (' + Object.keys(seen).length + ' имён)', Object.keys(seen).length > 50, Object.keys(seen).length);
ok('имена верхнего уровня не повторяются между файлами', !dups.length, dups.join(', '));
ok('имена не совпадают со встроенными именами окна браузера', !clash.length, clash.join(', '));
ok('у каждого файла есть отметка загрузки (для защиты от неполной заливки)', order.every((f) => fs.readFileSync(path.join(dir, f + '.js'), 'utf8').includes(`push('${f}')`)), '');
process.exit(0);
