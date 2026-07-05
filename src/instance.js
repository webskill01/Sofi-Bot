const crypto = require('crypto');

/**
 * Stable per-process instance id so multiple bots never share state or log files.
 *
 * Resolution order:
 *   1. INSTANCE_ID env var (set per-instance in ecosystem.config.js) — preferred.
 *   2. A short hash of the bot's TOKEN — guarantees two different bots are
 *      isolated even if INSTANCE_ID was forgotten (each token → its own files).
 *   3. 'default' — single-bot / no token (e.g. running tests).
 */
function resolveInstanceId() {
  if (process.env.INSTANCE_ID) return process.env.INSTANCE_ID;
  const token = process.env.TOKEN || '';
  if (token) return 'auto-' + crypto.createHash('sha1').update(token).digest('hex').slice(0, 8);
  return 'default';
}

module.exports = { instanceId: resolveInstanceId() };
