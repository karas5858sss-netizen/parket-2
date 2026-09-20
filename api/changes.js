// api/changes.js — «что изменилось в расписании».
// GET /api/changes (заголовок X-Init-Data): при необходимости сверяет расписание обоих профилей
// с прошлым снимком (не чаще раза в 5 минут) и отдаёт журнал изменений обоих профилей.

const { cfg, verifyInitData } = require('../lib/shared');
const { refreshChanges } = require('../lib/detect');
const { mskNow } = require('../lib/digest');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const c = cfg();
  const missing = [];
  if (!c.botToken) missing.push('BOT_TOKEN');
  if (!c.redisUrl || !c.redisToken) missing.push('Upstash Redis');
  if (missing.length) return res.status(503).json({ error: 'not_configured', missing });
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  const user = verifyInitData(String(req.headers['x-init-data'] || ''), c.botToken);
  if (!user) return res.status(401).json({ error: 'unauthorized' });
  if (!c.owners[String(user.id)]) return res.status(403).json({ error: 'not_allowed', yourId: user.id });

  const base = process.env.APP_URL || `https://${req.headers['x-forwarded-host'] || req.headers.host}`;
  try {
    const r = await refreshChanges({ base, today: mskNow().slice(0, 10), nowIso: new Date(Date.now()).toISOString() });
    return res.status(200).json({ items: r.items, checkedAt: new Date(Date.now()).toISOString() });
  } catch (e) {
    return res.status(502).json({ error: 'storage_failed', message: String((e && e.message) || e) });
  }
};
