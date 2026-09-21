// Простая имитация Redis: GET, SET [NX] [EX сек]; время берётся из Date.now (его подменяют в тестах).
module.exports = function makeKV() {
  const m = new Map();
  const get = (k) => { const e = m.get(k); if (!e) return null; if (e.exp && e.exp <= Date.now()) { m.delete(k); return null; } return e.v; };
  return { m, get, exec(cmd) {
    const [op, key, val, ...opts] = cmd;
    if (op === 'GET') return get(key);
    if (op === 'SET') {
      if (opts.includes('NX') && get(key) !== null) return null;
      const i = opts.indexOf('EX');
      m.set(key, { v: val, exp: i >= 0 ? Date.now() + Number(opts[i + 1]) * 1000 : 0 });
      return 'OK';
    }
    throw new Error('unsupported redis command ' + op);
  } };
};
